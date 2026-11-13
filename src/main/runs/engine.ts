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
  LaneStatus,
  Portal,
  PortalSetting,
  RunCard,
  RunEvent,
  RunEventKind,
  RunLane,
  RunState,
  RunStatus,
  RunUsage,
  ToolSite,
} from '../../shared/types'
import type { ChromeController, PageDriver, Tab } from '../browser/chrome'
import { claudeEnv, findClaude } from '../claude'
import type { Store } from '../db/store'

export const TOOL_SERVER = 'jobapp'
const MAX_EVENTS = 300
const MAX_LANE_EVENTS = 80
/** Sessions start this far apart, so five Claude Code processes don't all boot at once. */
const STAGGER_MS = 2000

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

/** What a flow's tools can do while their session lasts. */
export type RunContext = {
  runId: number
  store: Store
  /** The session's own tab: the tab Chrome shows when the run has one session, a tab of its own otherwise. */
  chrome: PageDriver
  resumePath: string
  log: (kind: RunEventKind, text: string) => void
  progress: (label: string, done: number, total: number) => void
  count: (key: string, by?: number) => void
  /** Shows a card and waits, for as long as the user needs. A stopped run answers `cancel`. */
  ask: (card: CardInput) => Promise<CardAnswer>
  /** What the user lets Claude do on a site: a portal, or Gmail. */
  portal: (site: ToolSite) => PortalSetting
  /** Tells the screens which data changed. */
  changed: (...topics: DataTopic[]) => void
  /**
   * Ends the run for every session, for a reason that holds for all of them,
   * such as LinkedIn's invitation limit: sessions not yet started never start.
   */
  halt: (reason: string) => void
  /** Why the run was halted, or null. */
  halted: () => string | null
}

/** One session: what to ask Claude, the tools it gets, the shape of its answer, and how it ends. */
export type FlowSpec<T> = {
  flow: Flow
  title: string
  subtitle?: string | null
  /** Its name beside the other sessions of a run, such as the company; by default its title. */
  laneTitle?: string
  portal: string | null
  /** The portals whose playbooks the session gets; by default its own portal. */
  playbooks?: Portal[]
  opportunityId?: number | null
  /** Lines for this flow, added to the rules every session keeps. */
  system: string
  prompt: string
  tools: (ctx: RunContext) => AnyTool[]
  output: z.ZodType<T>
  /** Puts the answer to use and says, in one line, how the session ended. */
  finish: (answer: T, ctx: RunContext) => string | Promise<string>
  maxTurns?: number
}

/** How each session ended, for the run's own line. */
export type SessionOutcome = { title: string; status: LaneStatus; result: string | null }

/** One run: one session, or several that run up to `atOnce` at a time, each in its own tab. */
export type RunPlan = {
  flow: Flow
  title: string
  subtitle?: string | null
  portal: string | null
  opportunityId?: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessions: FlowSpec<any>[]
  atOnce?: number
  /** What the progress bar counts with several sessions, such as "Rows done". */
  unit?: string
  /** The run's one line once every session has ended; by default each session's line. */
  finish?: (outcomes: SessionOutcome[], halted: string | null) => string
}

/** A run of one session, named as the session is. */
export function onePlan<T>(spec: FlowSpec<T>): RunPlan {
  return { flow: spec.flow, title: spec.title, subtitle: spec.subtitle, portal: spec.portal, opportunityId: spec.opportunityId, sessions: [spec] }
}

/** The lines every session keeps, whatever the flow. */
const BASE_SYSTEM = [
  'You work inside Dream Job, a job-search app, on behalf of its user, in a Chrome window they are signed in to.',
  'You act only through the tools the app gives you. Each tool says what it does; prefer a portal\'s own tools over reading and clicking pages.',
  'Never sign in, create an account, type a password or a one-time code, solve a CAPTCHA, enter payment or bank details or a government ID, or use the camera or microphone. When a page needs any of these, call hand_to_user with what the user must do, then read the page again when it returns.',
  'Never invent experience, numbers or technologies. Everything you write about the user comes from their profile as the app gives it to you.',
  'If a tool is refused because the user stopped the run, finish at once.',
  'Read only the pages the task needs, and keep your notes short.',
].join('\n')

/** The playbooks of the session's portals: its own, or the ones it names. */
function playbooksOf(spec: { portal: string | null; playbooks?: Portal[] }): string {
  const own = spec.portal?.toLowerCase() as Portal | undefined
  const portals = spec.playbooks ?? (own && PORTALS.includes(own) ? [own] : [])
  return portals
    .map(portal => [`Notes on ${PORTAL_NAMES[portal]}, from its live pages. Its tools are named ${portal}_<tool>.`, ...PLAYBOOKS[portal].map(line => `- ${line}`)].join('\n'))
    .join('\n\n')
}

/** The prompt as a stream: one message, held open so the session can be interrupted, until it ends. */
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

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const NO_USAGE: RunUsage = { turns: 0, inputTokens: 0, outputTokens: 0, ms: 0 }

const isActive = (status: LaneStatus): boolean => status === 'running' || status === 'waiting'

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

/** One session while it runs: its state on screen, its Claude Code session, its tab. */
type Lane = {
  state: RunLane
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spec: FlowSpec<any>
  session: Query | null
  end: AbortController | null
  tab: Tab | null
  /** Usage of turns so far, until the session's result gives the totals. */
  turns: number
}

/** A card on screen and every session waiting on it. */
type OpenCard = { card: RunCard; share: string | null; waiters: { lane: Lane; resolve: (answer: CardAnswer) => void }[] }

/**
 * Runs one flow at a time through the user's own Claude Code: no built-in
 * tools, no settings, no API key, only the app's tools. A run is one session,
 * or several that work at once, each with its own Chrome tab and its own
 * card; up to `atOnce` run together and the rest wait their turn. Every step
 * is kept in the run's activity log; each answer is checked against a schema
 * before it is used; anything the user must decide waits on a card for as
 * long as needed, while the other sessions carry on.
 */
export class RunEngine {
  private state: RunState | null = null
  private lanes: Lane[] = []
  private cards = new Map<string, OpenCard>()
  private isStopping = false
  private haltReason: string | null = null

  constructor(private readonly deps: EngineDeps) {}

  current(): RunState | null {
    return this.state
  }

  isBusy(): boolean {
    return this.state?.status === 'running' || this.state?.status === 'waiting'
  }

  /** Starts a run and answers its id at once; the run carries on in the background. */
  async start(plan: RunPlan): Promise<number> {
    if (this.isBusy()) throw new Error('A run is already going. One runs at a time.')
    if (plan.sessions.length === 0) throw new Error('There is nothing for this run to do.')
    const path = await findClaude()
    if (!path) throw new Error('Claude Code was not found. Install it and sign in, then try again.')

    const runId = this.deps.store.runs.start(plan.flow, plan.title, plan.portal, plan.opportunityId ?? null)
    this.isStopping = false
    this.haltReason = null
    this.cards.clear()
    this.lanes = plan.sessions.map((spec, i) => ({
      spec,
      session: null,
      end: null,
      tab: null,
      turns: 0,
      state: {
        key: String(i),
        title: spec.laneTitle ?? spec.title,
        subtitle: spec.subtitle ?? null,
        portal: spec.portal,
        opportunityId: spec.opportunityId ?? null,
        status: 'queued',
        started: null,
        ended: null,
        progress: null,
        counts: {},
        card: null,
        events: [],
        last: null,
        usage: { ...NO_USAGE },
        result: null,
      },
    }))
    this.state = {
      id: runId,
      flow: plan.flow,
      title: plan.title,
      subtitle: plan.subtitle ?? null,
      portal: plan.portal,
      opportunityId: plan.opportunityId ?? null,
      status: 'running',
      started: new Date().toISOString(),
      model: null,
      progress: null,
      counts: {},
      card: null,
      events: [],
      usage: { ...NO_USAGE },
      result: null,
      lanes: this.lanes.map(lane => lane.state),
      atOnce: Math.max(1, Math.min(plan.atOnce ?? 1, plan.sessions.length)),
    }
    this.refresh(plan)
    this.deps.onData(['runs'])
    void this.run(plan, path, runId)
    return runId
  }

  /** The user's answer to a card on screen: every session waiting on it carries on. */
  answer(cardId: string, answer: CardAnswer): void {
    const open = this.cards.get(cardId)
    if (!open) return
    this.cards.delete(cardId)
    for (const waiter of open.waiters) waiter.resolve(answer)
  }

  /** Interrupts the run: waiting cards are cancelled, sessions end where they are, and no new one starts. */
  async stop(): Promise<void> {
    if (!this.isBusy()) return
    this.isStopping = true
    this.logRun('step', 'Stopping...')
    this.cancelCards(() => true)
    await Promise.all(this.lanes.map(lane => lane.session?.interrupt().catch(() => undefined)))
    for (const lane of this.lanes) lane.end?.abort()
  }

  /** Shows one session's tab in Chrome: by its key, or by a card it waits on. Without one, the tab Chrome follows. */
  async showTab(key: string): Promise<void> {
    const lane = this.lanes.find(one => one.state.key === key || one.state.card?.id === key)
    await (lane?.tab ?? this.deps.chrome).bringToFront()
  }

  private async run(plan: RunPlan, path: string, runId: number): Promise<void> {
    try {
      await this.deps.ensureChrome()
    } catch (error) {
      for (const lane of this.lanes) this.setLane(lane, { status: 'failed', result: 'Chrome could not be opened.' })
      return this.finishRun(plan, `Chrome could not be opened: ${error instanceof Error ? error.message : String(error)}`)
    }

    const ownTabs = this.lanes.length > 1
    let next = 0
    const worker = async (slot: number): Promise<void> => {
      await sleep(slot * STAGGER_MS)
      while (!this.isStopping && !this.haltReason && next < this.lanes.length) {
        const lane = this.lanes[next++]!
        await this.runLane(plan, lane, path, runId, ownTabs)
      }
    }
    await Promise.all(Array.from({ length: this.state!.atOnce }, (_, slot) => worker(slot)))

    for (const lane of this.lanes) {
      if (lane.state.status === 'queued') {
        this.setLane(lane, { status: 'stopped', result: this.haltReason ? `Not started: ${this.haltReason}.` : 'Not started: the run was stopped.' })
      }
    }
    this.finishRun(plan)
  }

  private async runLane(plan: RunPlan, lane: Lane, path: string, runId: number, ownTab: boolean): Promise<void> {
    this.setLane(lane, { status: 'running', started: new Date().toISOString() })
    this.refresh(plan)

    let tab: PageDriver = this.deps.chrome
    if (ownTab) {
      try {
        lane.tab = await this.deps.chrome.openTab()
        tab = lane.tab
      } catch (error) {
        this.endLane(plan, lane, 'failed', `Its Chrome tab did not open: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    // Stopped while its tab was opening: it never starts.
    if (this.isStopping) {
      this.endLane(plan, lane, 'stopped', 'Stopped by you.')
      await lane.tab?.close().catch(() => undefined)
      lane.tab = null
      return
    }

    const ctx = this.context(plan, runId, lane, tab)
    const spec = lane.spec
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
        allowedTools: tools.map(one => `mcp__${TOOL_SERVER}__${one.name}`),
        permissionMode: 'default',
        canUseTool: this.canUseTool(lane),
        systemPrompt: [BASE_SYSTEM, spec.system, playbooksOf(spec)].filter(Boolean).join('\n\n'),
        outputFormat: { type: 'json_schema', schema: schemaOf(spec.output) },
        persistSession: false,
        maxTurns: spec.maxTurns ?? 80,
      },
    })
    lane.session = session
    lane.end = end

    const stopped = (): string => (this.haltReason ? `Stopped: ${this.haltReason}.` : 'Stopped by you.')
    try {
      for await (const message of session) await this.take(plan, message, lane, ctx)
      if (isActive(lane.state.status)) {
        this.endLane(plan, lane, this.isStopping ? 'stopped' : 'failed', this.isStopping ? stopped() : 'The session ended without an answer.')
      }
    } catch (error) {
      if (isActive(lane.state.status)) {
        this.endLane(
          plan,
          lane,
          this.isStopping ? 'stopped' : 'failed',
          this.isStopping ? stopped() : `The session failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } finally {
      this.cancelCards(waiter => waiter === lane)
      end.abort()
      session.close()
      lane.session = null
      lane.end = null
      if (lane.tab) {
        await lane.tab.close().catch(() => undefined)
        lane.tab = null
      }
    }
  }

  private context(plan: RunPlan, runId: number, lane: Lane, tab: PageDriver): RunContext {
    return {
      runId,
      store: this.deps.store,
      chrome: tab,
      resumePath: this.deps.resumePath,
      log: (kind, text) => this.log(lane, kind, text),
      progress: (label, done, total) => {
        this.setLane(lane, { progress: { label, done, total } })
        this.refresh(plan)
      },
      count: (key, by = 1) => {
        this.setLane(lane, { counts: { ...lane.state.counts, [key]: (lane.state.counts[key] ?? 0) + by } })
        this.refresh(plan)
      },
      ask: card => this.ask(plan, lane, card),
      portal: site => (site === 'gmail' ? this.deps.store.settings.email() : this.deps.store.settings.portals()[site]),
      changed: (...topics) => this.deps.onData(topics),
      halt: reason => {
        if (this.haltReason) return
        this.haltReason = reason
        this.logRun('warn', `${reason}: no more sessions start.`)
      },
      halted: () => this.haltReason,
    }
  }

  /**
   * Puts a card on screen and waits. A session that needs the same sign-in
   * as one already waiting joins that card, so signing in once lets every
   * session on the site carry on.
   */
  private ask(plan: RunPlan, lane: Lane, input: CardInput): Promise<CardAnswer> {
    if (this.isStopping) return Promise.resolve({ kind: 'cancel' })
    const share = input.kind === 'handover' && input.what === 'sign-in' ? `sign-in:${lane.state.portal ?? ''}` : null
    return new Promise<CardAnswer>(resolve => {
      const joined = share ? [...this.cards.values()].find(open => open.share === share) : undefined
      const open = joined ?? { card: { ...input, id: randomUUID() } as RunCard, share, waiters: [] }
      open.waiters.push({ lane, resolve })
      if (!joined) this.cards.set(open.card.id, open)
      this.setLane(lane, { card: open.card, status: 'waiting' })
      this.refresh(plan)
      this.deps.onAttention()
    }).finally(() => {
      if (lane.state.status === 'waiting') this.setLane(lane, { card: null, status: 'running' })
      this.refresh(plan)
    })
  }

  /** Cancels the cards these sessions wait on; a card others still wait on stays for them. */
  private cancelCards(match: (lane: Lane) => boolean): void {
    for (const [id, open] of this.cards) {
      const leaving = open.waiters.filter(waiter => match(waiter.lane))
      open.waiters = open.waiters.filter(waiter => !match(waiter.lane))
      if (open.waiters.length === 0) this.cards.delete(id)
      for (const waiter of leaving) waiter.resolve({ kind: 'cancel' })
    }
  }

  /** Only the SDK's own answer tool reaches here; the app's tools are pre-approved and hold their own gates. */
  private canUseTool(lane: Lane): CanUseTool {
    return async (toolName, input): Promise<PermissionResult> => {
      if (toolName === 'StructuredOutput') return { behavior: 'allow', updatedInput: input }
      this.log(lane, 'error', `Refused ${toolName}: not available in this app.`)
      return { behavior: 'deny', message: `${toolName} is not available in this app.` }
    }
  }

  private async take(plan: RunPlan, message: SDKMessage, lane: Lane, ctx: RunContext): Promise<void> {
    if (message.type === 'system' && message.subtype === 'init') {
      if (this.state && !this.state.model) this.state.model = message.model
    } else if (message.type === 'assistant') {
      lane.turns++
      this.setLane(lane, { usage: { ...lane.state.usage, turns: lane.turns } })
      this.refresh(plan)
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.trim()) this.log(lane, 'claude', cut(block.text.trim(), 300))
        if (block.type === 'tool_use' && block.name !== 'StructuredOutput') this.log(lane, 'tool', describeCall(block.name, block.input))
      }
      if (message.error) this.log(lane, 'error', `Claude Code reported: ${message.error}`)
    } else if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (typeof block === 'object' && block.type === 'tool_result' && block.is_error) {
          const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          this.log(lane, 'warn', cut(text, 200))
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
      this.setLane(lane, { usage })
      this.refresh(plan)
      this.deps.store.runs.setUsage(ctx.runId, this.state!.usage)
      if (message.subtype !== 'success') {
        const why = this.haltReason ? `Stopped: ${this.haltReason}.` : 'Stopped by you.'
        this.endLane(plan, lane, this.isStopping ? 'stopped' : 'failed', this.isStopping ? why : `The session stopped: ${message.subtype}`)
      } else {
        const parsed = lane.spec.output.safeParse(message.structured_output)
        if (!parsed.success) this.endLane(plan, lane, 'failed', 'Claude answered in a shape the app does not accept.')
        else {
          try {
            this.endLane(plan, lane, 'done', await lane.spec.finish(parsed.data, ctx))
          } catch (error) {
            this.endLane(plan, lane, 'failed', `Saving the result failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      lane.end?.abort()
    }
  }

  private endLane(plan: RunPlan, lane: Lane, status: Extract<LaneStatus, 'done' | 'failed' | 'stopped'>, text: string): void {
    this.log(lane, status === 'done' ? 'good' : status === 'failed' ? 'error' : 'step', text)
    this.setLane(lane, { status, result: text, card: null, progress: null, ended: new Date().toISOString() })
    this.refresh(plan)
  }

  /** Ends the run once every session has: one session's line, or the plan's line for all of them. */
  private finishRun(plan: RunPlan, failure?: string): void {
    if (!this.state) return
    const outcomes = this.lanes.map(lane => ({ title: lane.state.title, status: lane.state.status, result: lane.state.result }))
    let status: Extract<RunStatus, 'done' | 'failed' | 'stopped'>
    let text: string
    if (failure) {
      status = 'failed'
      text = failure
    } else if (this.lanes.length === 1) {
      const only = this.lanes[0]!.state
      status = only.status === 'done' ? 'done' : only.status === 'stopped' ? 'stopped' : 'failed'
      text = only.result ?? 'The run ended without an answer.'
    } else {
      status = this.isStopping ? 'stopped' : outcomes.every(one => one.status === 'failed') ? 'failed' : 'done'
      text = plan.finish
        ? plan.finish(outcomes, this.haltReason)
        : outcomes.map(one => `${one.title}: ${one.result ?? one.status}`).join(' ')
      if (this.isStopping) text = `Stopped by you. ${text}`
    }
    this.logRun(status === 'done' ? 'good' : status === 'failed' ? 'error' : 'step', text)
    this.deps.store.runs.setUsage(this.state.id, this.state.usage)
    this.deps.store.runs.finish(this.state.id, status, text)
    this.state = { ...this.state, status, result: text, card: null, progress: null }
    this.push()
    this.deps.onData(['runs'])
  }

  /** Works out the run's own state from its sessions: status, progress, tallies, usage. */
  private refresh(plan: RunPlan): void {
    // Once the run has ended, a late word from a session changes nothing.
    if (!this.state || (this.state.status !== 'running' && this.state.status !== 'waiting')) return
    const states = this.lanes.map(lane => lane.state)
    const waiting = states.find(lane => lane.status === 'waiting')
    const status: RunStatus = waiting ? 'waiting' : 'running'
    if (status !== this.state.status) this.deps.store.runs.setStatus(this.state.id, status)

    const counts: Record<string, number> = {}
    for (const lane of states) for (const [key, n] of Object.entries(lane.counts)) counts[key] = (counts[key] ?? 0) + n
    const usage = states.reduce(
      (sum, lane) => ({
        turns: sum.turns + lane.usage.turns,
        inputTokens: sum.inputTokens + lane.usage.inputTokens,
        outputTokens: sum.outputTokens + lane.usage.outputTokens,
        ms: Math.max(sum.ms, lane.usage.ms),
      }),
      { ...NO_USAGE },
    )
    if (states.length > 1 && this.state.started) usage.ms = Date.now() - new Date(this.state.started).getTime()
    const progress =
      states.length === 1
        ? states[0]!.progress
        : { label: plan.unit ?? 'Sessions done', done: states.filter(lane => !isActive(lane.status) && lane.status !== 'queued').length, total: states.length }

    this.state = { ...this.state, status, counts, usage, progress, card: waiting?.card ?? null }
    this.push()
  }

  private log(lane: Lane, kind: RunEventKind, text: string): void {
    if (!this.state) return
    const named = this.lanes.length > 1 ? `${lane.state.title}: ${text}` : text
    const event: RunEvent = this.deps.store.runs.addEvent(this.state.id, kind, named)
    this.setLane(lane, { events: [...lane.state.events, { ...event, text }].slice(-MAX_LANE_EVENTS), last: kind === 'claude' ? lane.state.last : text })
    this.state = { ...this.state, events: [...this.state.events, event].slice(-MAX_EVENTS) }
    this.push()
  }

  /** A line about the whole run, not one session. */
  private logRun(kind: RunEventKind, text: string): void {
    if (!this.state) return
    const event = this.deps.store.runs.addEvent(this.state.id, kind, text)
    this.state = { ...this.state, events: [...this.state.events, event].slice(-MAX_EVENTS) }
    this.push()
  }

  /** Changes one session's state; the run's list of sessions follows. */
  private setLane(lane: Lane, patch: Partial<RunLane>): void {
    lane.state = { ...lane.state, ...patch }
    if (this.state) this.state = { ...this.state, lanes: this.lanes.map(one => one.state) }
  }

  private push(): void {
    this.deps.onState(this.state)
  }
}
