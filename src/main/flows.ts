import { randomUUID } from 'node:crypto'

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { CanUseTool, PermissionResult, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { FlowState, LogEntry, PendingApproval, WrittenAnswer } from '../shared/types'
import { BROWSER_SERVER, BROWSER_TOOLS, browserServer, SUBMIT_TOOL, SubmitInput } from './browser-tools'
import type { ChromeController } from './chrome'
import { claudeEnv, findClaude } from './claude'

const IDLE: FlowState = {
  name: null,
  status: 'idle',
  model: null,
  log: [],
  postings: [],
  note: null,
  stats: null,
  approval: null,
  handover: null,
}
const MAX_LOG = 200

const FORM_TEST_URL = 'https://httpbin.org/forms/post'
const HANDOVER_TEST_URL = 'https://www.google.com/recaptcha/api2/demo'

/** Who Claude is inside the app, and the lines it keeps to in every flow. */
const SYSTEM_PROMPT = [
  'You work inside Job App, a job-search app, on behalf of its user.',
  'You act only through the browser tools: open_page, read_page, click, type_text, submit and hand_to_user. They drive a Chrome window the user is signed in to.',
  'Read only, unless the task says otherwise: never press apply, send, post or sign-in controls.',
  'A form is sent only through submit, which shows your written answers to the user first. If submit is refused, the user cancelled: send nothing and finish.',
  'When a page needs a person (a sign-in, a CAPTCHA, a one-time code, an identity check), call hand_to_user with what they need to do, then read the page again and carry on when it returns.',
  'Never sign in, type a password or code, or solve a CAPTCHA yourself. If hand_to_user is refused, the user stopped the run: finish.',
  'If a page shows an error, say so in your answer instead of working around it.',
  'Read only the pages the task needs.',
].join('\n')

/** One flow: what to ask, the shape the answer must have, and what the app does with it. */
type FlowSpec<T> = {
  name: string
  prompt: string
  output: z.ZodType<T>
  /** Puts the answer on screen and says, in one line, how the run ended. */
  finish: (answer: T) => Promise<string>
}

const HuntOutput = z.object({
  postings: z
    .array(
      z.object({
        title: z.string(),
        company: z.string(),
        location: z.string(),
        posted: z.string().describe('When it was posted, as the page words it'),
        link: z.string().describe('The posting URL'),
      }),
    )
    .max(10),
  note: z.string().describe('Anything that stood in the way, or empty').optional(),
})

const FormOutput = z.object({
  submitted: z.boolean().describe('Whether the form was sent'),
  echoedComments: z.string().describe('The comments text as the response page shows it, or empty'),
  note: z.string().describe('Anything that stood in the way, or empty').optional(),
})

function huntPrompt(url: string): string {
  return [
    `Open this LinkedIn jobs search: ${url}`,
    'Read the first page of results and return up to 10 postings: title, company, location, when it was posted as the page says it,',
    'and the posting link, in the form https://www.linkedin.com/jobs/view/<id>/ when the page gives an id.',
    'Use only what the results page shows: do not open each posting.',
    'If the page asks you to sign in, hand it to the user with hand_to_user; if they stop the run instead, return no postings and say so in note.',
  ].join(' ')
}

const HandoverOutput = z.object({
  completed: z.boolean().describe('Whether the page now shows the verification succeeded'),
  pageSays: z.string().describe('What the page says after the user resumed, quoted'),
})

const HANDOVER_PROMPT = [
  `Open ${HANDOVER_TEST_URL}. It holds a CAPTCHA, which you must never solve or click yourself.`,
  'Call hand_to_user asking the user to complete the CAPTCHA and then press the page\'s Submit button themselves.',
  'When it returns, read the page and answer whether it now says the verification succeeded, quoting what it says.',
].join(' ')

const FORM_PROMPT = [
  `Open ${FORM_TEST_URL}. It is a public test form that echoes back what it receives, so use made-up sample details only, never real ones.`,
  'Fill every field: customer name, telephone, e-mail, a pizza size, one or two toppings, a delivery time if the field takes typing,',
  'and write one or two plain sentences for Delivery instructions.',
  'Then call submit with the number of the Submit order button and your Delivery instructions answer: its field number, its label and the text.',
  'If submit is refused, the user cancelled: answer with submitted false.',
  'If it goes through, read the response page and answer with the comments text it echoes back.',
].join(' ')

/** The JSON schema Claude's answer must match, made from the same definition the app checks it with. */
function schemaOf(output: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(output) as Record<string, unknown>
  delete schema['$schema']
  return schema
}

/** The prompt as a stream: one message, then held open so the run can be interrupted, until the run ends. */
async function* oneMessage(text: string, end: AbortSignal): AsyncGenerator<SDKUserMessage> {
  yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
  await new Promise<void>(resolve => end.addEventListener('abort', () => resolve(), { once: true }))
}

const cut = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length).trimEnd()}...` : text

/** A tool call in a few words: its short name and its arguments. */
function describeCall(name: string, input: unknown): string {
  const short = name.replace(`mcp__${BROWSER_SERVER}__`, '')
  const args = input && typeof input === 'object' ? Object.values(input as Record<string, unknown>) : []
  const text = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(', ')
  return `${short}${text ? ` ${cut(text, 120)}` : ''}`
}

/** Accepts only a LinkedIn URL for the mini hunt. */
function linkedinUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    return url.protocol === 'https:' && /(^|\.)linkedin\.com$/.test(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

/** The user's answer to a held submit. */
type Decision = { isApproved: true; answers: WrittenAnswer[] } | { isApproved: false; reason: string }

/**
 * Runs one flow at a time through the user's own Claude Code: no built-in
 * tools, no settings, no API key, only the app's browser tools. Every step
 * goes to the activity log; the answer is checked against a schema before it
 * reaches the screen; a submit waits for the user's approval.
 */
export class FlowRunner {
  private state: FlowState = IDLE
  private session: Query | null = null
  private endInput: AbortController | null = null
  private isStopping = false
  private waiting: { id: string; resolve: (decision: Decision) => void } | null = null
  private paused: { id: string; resolve: (outcome: 'resumed' | 'stopped') => void } | null = null
  /** The text the user approved in this run, for checking what the form received. */
  private approved: WrittenAnswer[] = []

  constructor(
    private readonly chrome: ChromeController,
    private readonly cwd: string,
    private readonly onChange: (state: FlowState) => void,
  ) {}

  current(): FlowState {
    return this.state
  }

  /** Read through a method: `set()` changes the status, which TypeScript's narrowing cannot see. */
  private isRunning(): boolean {
    return this.state.status === 'running'
  }

  async runMiniHunt(input: string): Promise<void> {
    const url = linkedinUrl(input)
    await this.run({
      name: 'Mini hunt',
      prompt: url ? huntPrompt(url) : '',
      output: HuntOutput,
      finish: async answer => {
        const note = answer.note?.trim() || null
        this.set({ postings: answer.postings, note })
        return `${answer.postings.length} posting${answer.postings.length === 1 ? '' : 's'} found${note ? `. ${note}` : ''}`
      },
    }, url ? null : 'Paste a LinkedIn jobs search URL, starting https://www.linkedin.com/.')
  }

  async runFormTest(): Promise<void> {
    await this.run({
      name: 'Form test',
      prompt: FORM_PROMPT,
      output: FormOutput,
      finish: async answer => {
        const note = answer.note?.trim() || null
        this.set({ note })
        if (!answer.submitted) return `Not submitted${note ? `. ${note}` : '.'}`
        return this.checkEcho(answer.echoedComments)
      },
    })
  }

  /**
   * Checks what httpbin received against the text the user approved, from the
   * response page itself rather than from Claude's report.
   */
  private async checkEcho(reported: string): Promise<string> {
    const approvedText = this.approved[0]?.text.trim()
    if (!approvedText) return 'Submitted, but no approved text was recorded to check against.'
    let received: string | null = null
    try {
      const body = await this.chrome.evaluate<string>('document.body.innerText')
      const echo = JSON.parse(body) as { form?: { comments?: string } }
      received = echo.form?.comments?.trim() ?? null
    } catch {
      received = null
    }
    if (received === null) {
      return `Submitted. The app could not read the response page; Claude reports the form received "${cut(reported, 120)}".`
    }
    if (received === approvedText) return 'Submitted. httpbin received exactly the text you approved.'
    this.log('error', `httpbin received "${cut(received, 160)}", not the approved "${cut(approvedText, 160)}".`)
    return 'Submitted, but httpbin received different text from what you approved.'
  }

  async runHandoverTest(): Promise<void> {
    await this.run({
      name: 'Hand-over test',
      prompt: HANDOVER_PROMPT,
      output: HandoverOutput,
      finish: async answer => {
        this.set({ note: answer.pageSays.trim() || null })
        return answer.completed
          ? 'Hand-over worked: you completed the CAPTCHA and Claude carried on from there.'
          : 'Claude carried on after you resumed, but the page does not show the verification succeeded.'
      },
    })
  }

  /**
   * Pauses the run for the user: the hand_to_user tool waits here, as long as
   * they need, until Resume or Stop.
   */
  private handOver = (reason: string): Promise<'resumed' | 'stopped'> =>
    new Promise(resolve => {
      const id = randomUUID()
      this.paused = { id, resolve }
      this.set({ handover: { id, reason } })
      this.log('step', `Handed over to you: ${reason}`)
    })

  resume(id: string): void {
    if (this.paused?.id !== id) return
    this.paused.resolve('resumed')
    this.paused = null
    this.set({ handover: null })
    this.log('step', 'You resumed: Claude carries on')
  }

  /** Approves the held submit with the text in the card's fields, which may be edited. */
  approve(id: string, texts: string[]): void {
    const held = this.state.approval
    if (!this.waiting || !held || this.waiting.id !== id || held.id !== id) return
    const answers = held.answers.map((answer, i) => ({ ...answer, text: texts[i] ?? answer.text }))
    this.waiting.resolve({ isApproved: true, answers })
  }

  cancel(id: string): void {
    if (this.waiting?.id === id) this.waiting.resolve({ isApproved: false, reason: 'The user cancelled.' })
  }

  /** Interrupts the run; a held submit is cancelled, and whatever Claude was doing ends there. */
  async stop(): Promise<void> {
    if (!this.session || !this.isRunning()) return
    this.isStopping = true
    this.log('step', 'Stopping...')
    this.waiting?.resolve({ isApproved: false, reason: 'The run was stopped.' })
    this.endPause()
    await this.session.interrupt().catch(() => undefined)
    this.endInput?.abort()
  }

  /**
   * The approval gate. The browser tools that only read, click or type are
   * pre-approved; `submit` comes here every time and waits, for as long as the
   * user needs, on the card. The SDK's own answer tool is allowed; anything
   * else is refused.
   */
  private canUseTool: CanUseTool = async (toolName, input, { signal, mcpServer }): Promise<PermissionResult> => {
    if (toolName === 'StructuredOutput') return { behavior: 'allow', updatedInput: input }
    if (toolName !== SUBMIT_TOOL || mcpServer?.source !== 'sdk') {
      this.log('error', `Refused ${toolName}: not available in this app.`)
      return { behavior: 'deny', message: `${toolName} is not available in this app.` }
    }
    const parsed = SubmitInput.safeParse(input)
    if (!parsed.success) return { behavior: 'deny', message: 'submit needs the button number and each answer with ref, label and text.' }

    const page = await this.chrome
      .evaluate<{ url: string; title: string }>('({ url: location.href, title: document.title })')
      .catch(() => ({ url: '', title: '' }))
    const id = randomUUID()
    const card: PendingApproval = { id, url: page.url, title: page.title, answers: parsed.data.answers }
    this.set({ approval: card })
    this.log('step', 'Waiting for your approval of the written answers')

    const decision = await new Promise<Decision>(resolve => {
      this.waiting = { id, resolve }
      signal.addEventListener('abort', () => resolve({ isApproved: false, reason: 'The run was stopped.' }), { once: true })
    })
    this.waiting = null
    this.set({ approval: null })

    if (!decision.isApproved) {
      this.log('step', `Cancelled: nothing was submitted. ${decision.reason}`)
      return { behavior: 'deny', message: `${decision.reason} Do not submit; leave the form as it is and finish.` }
    }
    this.approved = decision.answers
    const isEdited = decision.answers.some((answer, i) => answer.text !== parsed.data.answers[i]?.text)
    this.log('step', `Approved${isEdited ? ' with your edits' : ''}: submitting exactly the approved text`)
    return { behavior: 'allow', updatedInput: { ...parsed.data, answers: decision.answers } }
  }

  /** Ends a hand-over the run no longer needs. */
  private endPause(): void {
    if (!this.paused) return
    this.paused.resolve('stopped')
    this.paused = null
    this.set({ handover: null })
  }

  private async run<T>(spec: FlowSpec<T>, problem: string | null = null): Promise<void> {
    if (this.isRunning()) return
    this.isStopping = false
    this.approved = []
    this.set({ ...IDLE, name: spec.name, status: 'running' })

    if (problem) return this.finish('failed', problem)
    if (this.chrome.current().mode !== 'controlled') {
      return this.finish('failed', 'Press Open Chrome first, so the app can use its Chrome.')
    }
    const path = await findClaude()
    if (!path) return this.finish('failed', 'Claude Code was not found. See the Claude card.')

    this.log('step', `Started ${spec.name.toLowerCase()}`)
    const end = new AbortController()
    const session = query({
      prompt: oneMessage(spec.prompt, end.signal),
      options: {
        pathToClaudeCodeExecutable: path,
        cwd: this.cwd,
        env: claudeEnv(),
        settingSources: [],
        tools: [],
        mcpServers: { [BROWSER_SERVER]: browserServer(this.chrome, this.handOver) },
        allowedTools: BROWSER_TOOLS,
        permissionMode: 'default',
        canUseTool: this.canUseTool,
        systemPrompt: SYSTEM_PROMPT,
        outputFormat: { type: 'json_schema', schema: schemaOf(spec.output) },
        persistSession: false,
        maxTurns: 30,
      },
    })
    this.session = session
    this.endInput = end

    try {
      for await (const message of session) await this.take(message, spec)
      if (this.isRunning()) {
        this.finish(this.isStopping ? 'stopped' : 'failed', this.isStopping ? 'Stopped.' : 'The run ended without an answer.')
      }
    } catch (error) {
      if (this.isRunning()) {
        this.finish(
          this.isStopping ? 'stopped' : 'failed',
          this.isStopping ? 'Stopped.' : `The run failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } finally {
      this.waiting?.resolve({ isApproved: false, reason: 'The run ended.' })
      this.endPause()
      end.abort()
      session.close()
      this.session = null
      this.endInput = null
    }
  }

  private async take<T>(message: SDKMessage, spec: FlowSpec<T>): Promise<void> {
    if (message.type === 'system' && message.subtype === 'init') {
      this.set({ model: message.model })
      this.log('step', `Claude Code started, model ${message.model}`)
    } else if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.trim()) this.log('claude', cut(block.text.trim(), 300))
        // StructuredOutput is how the SDK collects the schema-checked answer, not a browser step.
        if (block.type === 'tool_use' && block.name === 'StructuredOutput') this.log('step', 'Answer ready')
        else if (block.type === 'tool_use') this.log('tool', describeCall(block.name, block.input))
      }
      if (message.error) this.log('error', `Claude Code reported: ${message.error}`)
    } else if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (typeof block === 'object' && block.type === 'tool_result' && block.is_error) {
          const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          this.log('error', `Refused: ${cut(text, 200)}`)
        }
      }
    } else if (message.type === 'result') {
      // `input_tokens` counts only what was neither written to nor read from
      // the cache, often a handful: all input is the three together.
      const cacheRead = message.usage.cache_read_input_tokens ?? 0
      const cacheWrite = message.usage.cache_creation_input_tokens ?? 0
      this.set({
        stats: {
          turns: message.num_turns,
          inputTokens: message.usage.input_tokens + cacheRead + cacheWrite,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: cacheRead,
          durationMs: message.duration_ms,
        },
      })
      if (message.subtype !== 'success') this.finish('failed', `The run stopped: ${message.subtype}`)
      else {
        const parsed = spec.output.safeParse(message.structured_output)
        if (!parsed.success) this.finish('failed', 'Claude answered in a shape the app does not accept.')
        else this.finish('done', await spec.finish(parsed.data))
      }
      this.endInput?.abort()
    }
  }

  private finish(status: 'done' | 'failed' | 'stopped', text: string): void {
    this.log(status === 'done' ? 'result' : status === 'failed' ? 'error' : 'step', text)
    this.set({ status })
  }

  private log(kind: LogEntry['kind'], text: string): void {
    this.set({ log: [...this.state.log, { at: Date.now(), kind, text }].slice(-MAX_LOG) })
  }

  private set(patch: Partial<FlowState>): void {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }
}
