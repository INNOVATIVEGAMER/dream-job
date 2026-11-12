import { randomUUID } from 'node:crypto'

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import type {
  CanUseTool,
  PermissionResult,
  Query,
  SdkMcpToolDefinition,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import { PLAYBOOKS } from '../../shared/playbooks'
import { PORTAL_NAMES, PORTALS } from '../../shared/types'
import type {
  CardAnswer,
  DataTopic,
  Flow,
  Portal,
  PortalSetting,
  RunCard,
  RunEvent,
  RunEventKind,
  RunState,
  RunStatus,
} from '../../shared/types'
import type { ChromeController } from '../browser/chrome'
import { claudeEnv, findClaude } from '../claude'
import type { Store } from '../db/store'

export const TOOL_SERVER = 'jobapp'
const MAX_EVENTS = 300

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type CardInput = DistributiveOmit<RunCard, 'id'>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = SdkMcpToolDefinition<any>

/** `tool()` with its input checked and its result typed, as an entry the shared tool list accepts. */
export function defineTool<S extends Parameters<typeof tool>[2]>(
  name: string,
  description: string,
  shape: S,
  handler: Parameters<typeof tool<S>>[3],
): AnyTool {
  return tool(name, description, shape, handler) as unknown as AnyTool
}

/** What a flow's tools can do while the run lasts. */
export type RunContext = {
  runId: number
  store: Store
  chrome: ChromeController
  resumePath: string
  log: (kind: RunEventKind, text: string) => void
  progress: (label: string, done: number, total: number) => void
  count: (key: string, by?: number) => void
  /** Shows a card and waits, for as long as the user needs. A stopped run answers `cancel`. */
  ask: (card: CardInput) => Promise<CardAnswer>
  portal: (portal: Portal) => PortalSetting
  /** Tells the screens which data changed. */
  changed: (...topics: DataTopic[]) => void
}

/** One flow: what to ask Claude, the tools it gets, the shape of its answer, and how the run ends. */
export type FlowSpec<T> = {
  flow: Flow
  title: string
  subtitle?: string | null
  portal: string | null
  /** The portals whose playbooks the run gets; by default the run's own portal. */
  playbooks?: Portal[]
  opportunityId?: number | null
  /** Lines for this flow, added to the rules every run keeps. */
  system: string
  prompt: string
  tools: (ctx: RunContext) => AnyTool[]
  output: z.ZodType<T>
  /** Puts the answer to use and says, in one line, how the run ended. */
  finish: (answer: T, ctx: RunContext) => string | Promise<string>
  maxTurns?: number
}

/** The lines every run keeps, whatever the flow. */
const BASE_SYSTEM = [
  'You work inside Job App, a job-search app, on behalf of its user, in a Chrome window they are signed in to.',
  'You act only through the tools the app gives you. Each tool says what it does; prefer a portal\'s own tools over reading and clicking pages.',
  'Never sign in, create an account, type a password or a one-time code, solve a CAPTCHA, enter payment or bank details or a government ID, or use the camera or microphone. When a page needs any of these, call hand_to_user with what the user must do, then read the page again when it returns.',
  'Never invent experience, numbers or technologies. Everything you write about the user comes from their profile as the app gives it to you.',
  'If a tool is refused because the user stopped the run, finish at once.',
  'Read only the pages the task needs, and keep your notes short.',
].join('\n')

/** The playbooks of the run's portals: its own, or the ones it names. */
function playbooksOf(spec: { portal: string | null; playbooks?: Portal[] }): string {
  const own = spec.portal?.toLowerCase() as Portal | undefined
  const portals = spec.playbooks ?? (own && PORTALS.includes(own) ? [own] : [])
  return portals
    .map(portal => [`Notes on ${PORTAL_NAMES[portal]}, from its live pages. Its tools are named ${portal}_<tool>.`, ...PLAYBOOKS[portal].map(line => `- ${line}`)].join('\n'))
    .join('\n\n')
}

/** The prompt as a stream: one message, held open so the run can be interrupted, until the run ends. */
async function* oneMessage(text: string, end: AbortSignal): AsyncGenerator<SDKUserMessage> {
  yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
  await new Promise<void>(resolve => end.addEventListener('abort', () => resolve(), { once: true }))
}

/** The JSON schema Claude's answer must match, made from the same definition the app checks it with. */
export function schemaOf(output: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(output) as Record<string, unknown>
  delete schema['$schema']
  return schema
}

export const cut = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length).trimEnd()}...` : text

function describeCall(name: string, input: unknown): string {
  const short = name.replace(`mcp__${TOOL_SERVER}__`, '')
  const args = input && typeof input === 'object' ? Object.values(input as Record<string, unknown>) : []
  const text = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(', ')
  return `${short.replace(/_/g, ' ')}${text ? `: ${cut(text, 100)}` : ''}`
}

export type EngineDeps = {
  store: Store
  chrome: ChromeController
  resumePath: string
  cwd: string
  /** Opens Chrome under the app's control when a run needs it. */
  ensureChrome: () => Promise<void>
  onState: (state: RunState | null) => void
  onData: (topics: DataTopic[]) => void
  /** A card wants the user: bring the app to the front. */
  onAttention: () => void
}

/**
 * Runs one flow at a time through the user's own Claude Code: no built-in
 * tools, no settings, no API key, only the app's tools. Every step is kept in
 * the run's activity log; the answer is checked against a schema before it is
 * used; anything the user must decide waits on a card for as long as needed.
 */
export class RunEngine {
  private state: RunState | null = null
  private session: Query | null = null
  private endInput: AbortController | null = null
  private isStopping = false
  private waiting: { id: string; resolve: (answer: CardAnswer) => void } | null = null

  constructor(private readonly deps: EngineDeps) {}

  current(): RunState | null {
    return this.state
  }

  isBusy(): boolean {
    return this.state?.status === 'running' || this.state?.status === 'waiting'
  }

  /** Starts a run and answers its id at once; the run carries on in the background. */
  async start<T>(spec: FlowSpec<T>): Promise<number> {
    if (this.isBusy()) throw new Error('A run is already going. One runs at a time.')
    const path = await findClaude()
    if (!path) throw new Error('Claude Code was not found. Install it and sign in, then try again.')

    const runId = this.deps.store.runs.start(spec.flow, spec.title, spec.portal, spec.opportunityId ?? null)
    this.isStopping = false
    this.state = {
      id: runId,
      flow: spec.flow,
      title: spec.title,
      subtitle: spec.subtitle ?? null,
      portal: spec.portal,
      opportunityId: spec.opportunityId ?? null,
      status: 'running',
      started: new Date().toISOString(),
      model: null,
      progress: null,
      counts: {},
      card: null,
      events: [],
      usage: { turns: 0, inputTokens: 0, outputTokens: 0, ms: 0 },
      result: null,
    }
    this.push()
    this.deps.onData(['runs'])
    void this.run(spec, path, runId)
    return runId
  }

  /** The user's answer to the card on screen. */
  answer(cardId: string, answer: CardAnswer): void {
    if (this.waiting?.id !== cardId) return
    this.waiting.resolve(answer)
  }

  /** Interrupts the run; a waiting card is cancelled, and whatever Claude was doing ends there. */
  async stop(): Promise<void> {
    if (!this.isBusy()) return
    this.isStopping = true
    this.log('step', 'Stopping...')
    this.waiting?.resolve({ kind: 'cancel' })
    await this.session?.interrupt().catch(() => undefined)
    this.endInput?.abort()
  }

  private context(runId: number): RunContext {
    return {
      runId,
      store: this.deps.store,
      chrome: this.deps.chrome,
      resumePath: this.deps.resumePath,
      log: (kind, text) => this.log(kind, text),
      progress: (label, done, total) => this.set({ progress: { label, done, total } }),
      count: (key, by = 1) => this.set({ counts: { ...(this.state?.counts ?? {}), [key]: (this.state?.counts[key] ?? 0) + by } }),
      ask: card => this.ask(card),
      portal: portal => this.deps.store.settings.portals()[portal],
      changed: (...topics) => this.deps.onData(topics),
    }
  }

  private ask(card: CardInput): Promise<CardAnswer> {
    if (this.isStopping) return Promise.resolve({ kind: 'cancel' })
    const id = randomUUID()
    return new Promise<CardAnswer>(resolve => {
      this.waiting = { id, resolve }
      this.set({ card: { ...card, id } as RunCard, status: 'waiting' })
      this.persistStatus('waiting')
      this.deps.onAttention()
    }).finally(() => {
      this.waiting = null
      if (this.state?.status === 'waiting') {
        this.set({ card: null, status: 'running' })
        this.persistStatus('running')
      }
    })
  }

  /** Only the SDK's own answer tool reaches here; the app's tools are pre-approved and hold their own gates. */
  private canUseTool: CanUseTool = async (toolName, input): Promise<PermissionResult> => {
    if (toolName === 'StructuredOutput') return { behavior: 'allow', updatedInput: input }
    this.log('error', `Refused ${toolName}: not available in this app.`)
    return { behavior: 'deny', message: `${toolName} is not available in this app.` }
  }

  private async run<T>(spec: FlowSpec<T>, path: string, runId: number): Promise<void> {
    const ctx = this.context(runId)
    try {
      await this.deps.ensureChrome()
    } catch (error) {
      return this.finish('failed', `Chrome could not be opened: ${error instanceof Error ? error.message : String(error)}`)
    }

    const tools = spec.tools(ctx)
    const end = new AbortController()
    const session = query({
      prompt: oneMessage(spec.prompt, end.signal),
      options: {
        pathToClaudeCodeExecutable: path,
        cwd: this.deps.cwd,
        env: claudeEnv(),
        settingSources: [],
        tools: [],
        mcpServers: { [TOOL_SERVER]: createSdkMcpServer({ name: TOOL_SERVER, version: '1.0.0', tools }) },
        allowedTools: tools.map(tool => `mcp__${TOOL_SERVER}__${tool.name}`),
        permissionMode: 'default',
        canUseTool: this.canUseTool,
        systemPrompt: [BASE_SYSTEM, spec.system, playbooksOf(spec)].filter(Boolean).join('\n\n'),
        outputFormat: { type: 'json_schema', schema: schemaOf(spec.output) },
        persistSession: false,
        maxTurns: spec.maxTurns ?? 80,
      },
    })
    this.session = session
    this.endInput = end

    try {
      for await (const message of session) await this.take(message, spec, ctx)
      if (this.isBusy()) {
        this.finish(this.isStopping ? 'stopped' : 'failed', this.isStopping ? 'Stopped by you.' : 'The run ended without an answer.')
      }
    } catch (error) {
      if (this.isBusy()) {
        this.finish(
          this.isStopping ? 'stopped' : 'failed',
          this.isStopping ? 'Stopped by you.' : `The run failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } finally {
      this.waiting?.resolve({ kind: 'cancel' })
      end.abort()
      session.close()
      this.session = null
      this.endInput = null
    }
  }

  private async take<T>(message: SDKMessage, spec: FlowSpec<T>, ctx: RunContext): Promise<void> {
    if (message.type === 'system' && message.subtype === 'init') {
      this.set({ model: message.model })
    } else if (message.type === 'assistant') {
      this.set({ usage: { ...this.state!.usage, turns: this.state!.usage.turns + 1 } })
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.trim()) this.log('claude', cut(block.text.trim(), 300))
        if (block.type === 'tool_use' && block.name !== 'StructuredOutput') this.log('tool', describeCall(block.name, block.input))
      }
      if (message.error) this.log('error', `Claude Code reported: ${message.error}`)
    } else if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (typeof block === 'object' && block.type === 'tool_result' && block.is_error) {
          const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          this.log('warn', cut(text, 200))
        }
      }
    } else if (message.type === 'result') {
      // `input_tokens` counts only what was neither written to nor read from the cache: all input is the three together.
      const usage = {
        turns: message.num_turns,
        inputTokens:
          message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
        ms: message.duration_ms,
      }
      this.set({ usage })
      this.deps.store.runs.setUsage(ctx.runId, usage)
      if (message.subtype !== 'success') {
        this.finish(this.isStopping ? 'stopped' : 'failed', this.isStopping ? 'Stopped by you.' : `The run stopped: ${message.subtype}`)
      } else {
        const parsed = spec.output.safeParse(message.structured_output)
        if (!parsed.success) this.finish('failed', 'Claude answered in a shape the app does not accept.')
        else {
          try {
            this.finish('done', await spec.finish(parsed.data, ctx))
          } catch (error) {
            this.finish('failed', `Saving the result failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      this.endInput?.abort()
    }
  }

  private finish(status: Extract<RunStatus, 'done' | 'failed' | 'stopped'>, text: string): void {
    if (!this.state) return
    this.log(status === 'done' ? 'good' : status === 'failed' ? 'error' : 'step', text)
    this.deps.store.runs.finish(this.state.id, status, text)
    this.set({ status, result: text, card: null, progress: null })
    this.deps.onData(['runs'])
  }

  private persistStatus(status: RunStatus): void {
    if (this.state) this.deps.store.runs.setStatus(this.state.id, status)
  }

  private log(kind: RunEventKind, text: string): void {
    if (!this.state) return
    const event: RunEvent = this.deps.store.runs.addEvent(this.state.id, kind, text)
    this.set({ events: [...this.state.events, event].slice(-MAX_EVENTS) })
  }

  private set(patch: Partial<RunState>): void {
    if (!this.state) return
    this.state = { ...this.state, ...patch }
    this.push()
  }

  private push(): void {
    this.deps.onState(this.state)
  }
}
