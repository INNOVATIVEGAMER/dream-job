/**
 * How the app's Chrome window is running: not at all, open for signing in
 * with no control link, or open and controlled by the app.
 */
export type ChromeMode = 'closed' | 'signin' | 'controlled'

/** What the panel shows about Chrome, sent by the main process on every change. */
export type BrowserState = {
  mode: ChromeMode
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  /** Why the last open or command failed, until the next one succeeds. */
  error: string | null
}

/**
 * The setup check's verdict on the user's Claude Code:
 * - `ok`: signed in with a Claude subscription, so usage bills the plan
 * - `signed-out`: installed, not signed in
 * - `api-key`: signed in through an API key, which would bill the API instead
 * - `other-provider`: set up for Bedrock, Vertex or another provider
 * - `missing`: no `claude` found
 * - `error`: the check itself failed
 */
export type ClaudeState = 'checking' | 'ok' | 'signed-out' | 'api-key' | 'other-provider' | 'missing' | 'error'

/** What Claude Code reports about the signed-in account, as the Agent SDK gives it. */
export type ClaudeAccount = {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiKeySource?: string
  apiProvider?: string
}

export type ClaudeStatus = {
  state: ClaudeState
  /** One line for the panel: what was found, or what to do. */
  message: string
  path: string | null
  version: string | null
  account: ClaudeAccount | null
}

/** One job posting as the mini hunt reads it off a results page. */
export type Posting = { title: string; company: string; location: string; posted: string; link: string }

/** One line of a flow's activity log. */
export type LogEntry = {
  at: number
  kind: 'step' | 'claude' | 'tool' | 'result' | 'error'
  text: string
}

/** What a finished run cost: model round trips, tokens and wall-clock time. */
export type FlowStats = {
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  durationMs: number
}

export type FlowStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

/** One written answer Claude wants to submit: its field, the question as the form words it, the text. */
export type WrittenAnswer = { ref: number; label: string; text: string }

/** A submit held until the user approves or cancels it. */
export type PendingApproval = { id: string; url: string; title: string; answers: WrittenAnswer[] }

/** A run paused for something only the user can do, such as a CAPTCHA or a sign-in. */
export type Handover = { id: string; reason: string }

/** The one flow that runs at a time, as the panel shows it. */
export type FlowState = {
  name: string | null
  status: FlowStatus
  model: string | null
  log: LogEntry[]
  postings: Posting[]
  /** What Claude said alongside its results, such as a sign-in wall it met. */
  note: string | null
  stats: FlowStats | null
  /** A submit waiting for the user, shown as a card until they decide. */
  approval: PendingApproval | null
  /** A pause handed to the user, shown as a card until they resume. */
  handover: Handover | null
}

/** The tracker's statuses, in the order an opportunity moves through them. */
export const STATUSES = ['found', 'applied', 'outreach', 'replied', 'screen', 'onsite', 'offer', 'rejected', 'dead'] as const
export type Status = (typeof STATUSES)[number]

/** One opportunity as the tracker screen shows it. */
export type TrackerRow = {
  id: number
  company: string
  role: string
  stage: string
  score: number | null
  status: string
  lastTouch: string
  nextAction: string
  portal: string
  jobId: string
  link: string | null
  postingState: string | null
}

/** One page of the tracker, with the counts the filter shows. */
export type TrackerPage = {
  rows: TrackerRow[]
  /** Rows matching the filter. */
  total: number
  /** Rows in the whole tracker. */
  all: number
  counts: Record<string, number>
  page: number
  pages: number
  pageSize: number
}

/** Fixed facts about the app's Chrome, for the panel to show. */
export type BrowserInfo = {
  chromePath: string
  profileDir: string
}
