/**
 * How the app's Chrome window is running: not at all, open for signing in
 * with no control link, or open and controlled by the app.
 */
export type ChromeMode = 'closed' | 'signin' | 'controlled'

/** What the screens show about Chrome, sent by the main process on every change. */
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
  /** One line: what was found, or what to do. */
  message: string
  path: string | null
  version: string | null
  account: ClaudeAccount | null
}

/* ------------------------------------------------------------------ */
/* Tracker                                                             */
/* ------------------------------------------------------------------ */

/** The tracker's statuses, in the order an opportunity moves through them. */
export const STATUSES = ['found', 'applied', 'outreach', 'replied', 'screen', 'onsite', 'offer', 'rejected', 'dead'] as const
export type Status = (typeof STATUSES)[number]

export const STAGES = ['startup', 'scaleup', 'large'] as const
export type Stage = (typeof STAGES)[number]

/** The portals v1 drives. Rows from before the app keep whatever source they came from. */
export const PORTALS = ['linkedin', 'wellfound', 'instahyre'] as const
export type Portal = (typeof PORTALS)[number]

/** Portals whose own tools are built so far; the hunt runs only on these. */
export const HUNT_PORTALS: readonly Portal[] = ['linkedin', 'wellfound', 'instahyre']

export const PORTAL_NAMES: Record<Portal, string> = {
  linkedin: 'LinkedIn',
  wellfound: 'Wellfound',
  instahyre: 'Instahyre',
}

/** The sites the user signs in to in the app's Chrome: Google, for "Continue with Google", and each portal. */
export const SIGN_IN_SITES = ['google', ...PORTALS] as const
export type SignInSite = (typeof SIGN_IN_SITES)[number]

export const SIGN_IN_URLS: Record<SignInSite, string> = {
  google: 'https://accounts.google.com/',
  linkedin: 'https://www.linkedin.com/login',
  wellfound: 'https://wellfound.com/login',
  instahyre: 'https://www.instahyre.com/login/',
}

export const SITE_NAMES: Record<SignInSite, string> = { google: 'Google', ...PORTAL_NAMES }

/** The sites Claude works in through the app's own tools: the portals, and Gmail for the email check. */
export type ToolSite = Portal | 'gmail'

export const TOOL_SITE_NAMES: Record<ToolSite, string> = { ...PORTAL_NAMES, gmail: 'Gmail' }

/** One opportunity as a table row shows it. */
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
  /** The company it belongs to. */
  companyId?: number | null
}

/** Everything about one opportunity, for its own screen. */
export type Opportunity = TrackerRow & {
  found: string
  mode: string
  applicants: string
  referral: string
  notes: string
  pay: string | null
  experience: string | null
  applyRoute: string | null
  scoreReasons: string[]
  postingChecked: string | null
  postingNote: string | null
}

/** One line of an opportunity's history. */
export type OpportunityEvent = { id: number; at: string; text: string; runId: number | null }

export type TrackerQuery = {
  status: string
  stage: string
  /** A v1 portal, `other` for everything else, or `all`. */
  portal: string
  search: string
  page: number
}

/** One page of the tracker, with the counts the filters show. */
export type TrackerPage = {
  rows: TrackerRow[]
  /** Rows matching the filters. */
  total: number
  /** Rows in the whole tracker. */
  all: number
  counts: Record<string, number>
  page: number
  pages: number
  pageSize: number
}

/* ------------------------------------------------------------------ */
/* Companies: what every job, contact and email belongs to             */
/* ------------------------------------------------------------------ */

/** The tracker's views, each a set of job statuses. */
export const TRACKER_VIEWS = ['found', 'applied', 'interviewing', 'closed', 'all'] as const
export type TrackerView = (typeof TRACKER_VIEWS)[number]

export const VIEW_STATUSES: Record<TrackerView, readonly Status[] | null> = {
  found: ['found'],
  applied: ['applied', 'outreach', 'replied'],
  interviewing: ['screen', 'onsite', 'offer'],
  closed: ['rejected', 'dead'],
  all: null,
}

export const TRACKER_VIEW_NAMES: Record<TrackerView, string> = {
  found: 'Found',
  applied: 'Applied',
  interviewing: 'Interviewing',
  closed: 'Closed',
  all: 'All',
}

export type Company = {
  id: number
  name: string
  stage: string
  linkedinUrl: string | null
  website: string | null
  headcount: string | null
  notes: string
  /** Hunts skip every job here; the company stays in the tracker. */
  neverShow: boolean
  neverWhy: string | null
  neverSince: string | null
  added: string
}

/** One company as the tracker lists it, with the jobs the view shows. */
export type CompanyRow = {
  id: number
  name: string
  stage: string
  /** The status of its job furthest along; a closed job counts only when all are closed. */
  status: string
  bestScore: number | null
  updated: string
  /** All its jobs, whatever the view. */
  jobCount: number
  referral: Record<ContactState, number>
  neverShow: boolean
  jobs: TrackerRow[]
}

export type CompanyQuery = { view: TrackerView; stage: string; portal: string; search: string }

export type CompanyList = {
  companies: CompanyRow[]
  /** Companies in each view. */
  counts: Record<TrackerView, number>
  totalCompanies: number
  totalJobs: number
}

/** One line of a company's history: from one of its jobs, or its people. */
export type CompanyEvent = { key: string; at: string; kind: 'job' | 'contact'; text: string; jobId: number | null; runId: number | null }

export type CompanyDetail = { company: Company; jobs: TrackerRow[]; contacts: Contact[]; events: CompanyEvent[] }

/** A row the user adds by hand, such as a recruiter who called. */
export type NewOpportunity = {
  company: string
  role: string
  stage: Stage
  portal: string
  link: string
  mode: string
  notes: string
}

/* ------------------------------------------------------------------ */
/* Discarded and never show again                                      */
/* ------------------------------------------------------------------ */

export const DISCARD_REASONS = ['below-floor', 'over-ceiling', 'skipped-role', 'location', 'closed', 'other'] as const
export type DiscardReason = (typeof DISCARD_REASONS)[number]

export const DISCARD_REASON_NAMES: Record<DiscardReason, string> = {
  'below-floor': 'Below your floor',
  'over-ceiling': 'Over your ceiling',
  'skipped-role': 'A role you skip',
  location: 'Location',
  closed: 'Closed',
  other: 'Other',
}

export type DiscardedPosting = {
  id: number
  at: string
  company: string
  role: string
  portal: string
  jobId: string
  link: string | null
  /** The posting's own words that ruled it out, quoted exactly. */
  line: string
  reason: DiscardReason
  runId: number | null
}

export type DiscardedQuery = { reason: string; search: string; page: number }

export type DiscardedPage = { rows: DiscardedPosting[]; total: number; page: number; pages: number; pageSize: number }

export type NeverShowCompany = { id: number; company: string; why: string; added: string }

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

export const CONTACT_STATES = ['pending', 'accepted', 'messaged', 'referred'] as const
export type ContactState = (typeof CONTACT_STATES)[number]

export type Contact = {
  id: number
  name: string
  role: string
  company: string
  profileUrl: string
  sent: string
  state: ContactState
  acceptedAt: string | null
  messagedAt: string | null
  referredAt: string | null
  thankedAt?: string | null
}

/** Contacts, company first: the views over people. */
export const CONTACT_VIEWS = ['ready', 'pending', 'accepted', 'messaged', 'referred', 'all'] as const
export type ContactView = (typeof CONTACT_VIEWS)[number]

/** One company as Contacts lists it: the job applied for, where its people stand, and the people in the view. */
export type ContactCompany = {
  id: number
  name: string
  jobId: number | null
  role: string | null
  counts: Record<ContactState, number>
  isReady: boolean
  people: Contact[]
}

export type ContactCompanies = { companies: ContactCompany[]; counts: Record<ContactView, number>; people: number; companyCount: number }

export type ContactQuery = { state: string; company: string; search: string; page: number }

export type ContactPage = {
  rows: Contact[]
  total: number
  counts: Record<ContactState, number>
  companies: string[]
  page: number
  pages: number
  pageSize: number
}

/** A company with accepted connections waiting for the referral message. */
export type ReadyCompany = {
  company: string
  accepted: number
  pending: number
  /** Enough accepted for a batch; otherwise it waits, unless the user sends anyway. */
  isReady: boolean
  /** The applied row the message points at, when there is one. */
  opportunityId: number | null
  role: string | null
  appliedOn: string | null
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD'] as const
export type Currency = (typeof CURRENCIES)[number]

export const PAY_PERIODS = ['year', 'month', 'hour'] as const
export type PayPeriod = (typeof PAY_PERIODS)[number]

export const HUNT_WINDOWS = ['day', 'week', 'month'] as const
export type HuntWindow = (typeof HUNT_WINDOWS)[number]

export const HUNT_WINDOW_NAMES: Record<HuntWindow, string> = {
  day: 'The past 24 hours',
  week: 'The past week',
  month: 'The past month',
}

/** What the user is looking for: the hunt searches and scores against it. */
export type Preferences = {
  /** Job titles to search for, one search each. */
  targetRoles: string[]
  /** Kinds of role never wanted, such as "Backend-only". */
  skipRoles: string[]
  /** Most years of experience a posting may ask for. */
  ceilingYears: number | null
  window: HuntWindow
  country: string
  /** Cities for on-site and hybrid roles. */
  cities: string[]
  modes: { remote: boolean; hybrid: boolean; onsite: boolean }
  needsVisa: boolean
  currency: Currency
  /** The pay floor, in `currency` per `period`; for INR a year, in lakh. */
  floor: number | null
  period: PayPeriod
}

/** One role in the user's experience, used exactly as written. */
export type Role = {
  id: string
  title: string
  company: string
  /** YYYY-MM */
  start: string
  /** YYYY-MM, or null while `isCurrent`. */
  end: string | null
  isCurrent: boolean
  /** What they built there and with what, one point per line. */
  built: string
  skills: string[]
}

export type Project = { id: string; name: string; link: string; about: string }

export type ProfileLinks = {
  linkedin: string
  github: string
  site: string
  other: { name: string; url: string }[]
}

/** The source of truth every written answer is drawn from. */
export type Profile = {
  name: string
  headline: string
  /** Where the user lives: city, country. */
  location: string
  roles: Role[]
  projects: Project[]
  skills: string[]
  links: ProfileLinks
  /** What is never mentioned or linked, one per line. */
  never: string
}

export type ReferralMessage = {
  /** The approved wording, with {name}, {role}, {company} and {job link} slots. */
  template: string
  attachResume: boolean
}

export type ResumeInfo = { fileName: string; addedAt: string; pages: number | null; bytes: number }

export type FormAnswer = { id: number; question: string; answer: string; updated: string }

/** What Claude may do on one portal. */
export type PortalSetting = { enabled: boolean; tools: Record<string, boolean>; freeBrowsing: boolean }

export type PortalSettings = Record<Portal, PortalSetting>

/** How the email check reads Gmail, and what Claude may do there. */
export type EmailSettings = {
  enabled: boolean
  tools: Record<string, boolean>
  freeBrowsing: boolean
  /** How many of the newest emails a check reads. */
  count: EmailCount
  /** Start a check when the app opens, at most once a day. */
  checkOnOpen: boolean
}

export const EMAIL_COUNTS = [25, 50, 100] as const
export type EmailCount = (typeof EMAIL_COUNTS)[number]

export type Settings = {
  preferences: Preferences
  profile: Profile
  referral: ReferralMessage
  resume: ResumeInfo | null
  portals: PortalSettings
  /** Onboarding finished. */
  isSetUp: boolean
  email: EmailSettings
}

/* ------------------------------------------------------------------ */
/* Portal tools                                                        */
/* ------------------------------------------------------------------ */

export type PortalToolGroup = 'find' | 'apply' | 'connect' | 'read'

export const PORTAL_TOOL_GROUP_NAMES: Record<PortalToolGroup, string> = {
  find: 'Find jobs',
  apply: 'Apply',
  connect: 'Connect and message',
  read: 'Read mail',
}

/** One of a portal's own tools, as Settings lists it. */
export type PortalToolInfo = {
  name: string
  label: string
  detail: string
  group: PortalToolGroup
  /** When the tool stops for the user first, said in a few words. */
  asksFirst?: string
}

/** Each portal's own tools: the switches in Settings, Portals. */
export const PORTAL_TOOLS: Record<Portal, PortalToolInfo[]> = {
  linkedin: [
    { name: 'search_jobs', label: 'Search jobs', detail: 'By role, place, remote and how recent', group: 'find' },
    { name: 'read_job', label: 'Read a posting', detail: 'Pay, size, applicants, apply route, description', group: 'find' },
    {
      name: 'easy_apply_fill',
      label: 'Fill Easy Apply forms',
      detail: 'Open the form, fill each page, go to the next',
      group: 'apply',
      asksFirst: 'Shows you written answers before typing them',
    },
    { name: 'easy_apply_submit', label: 'Submit Easy Apply', detail: 'Press Submit application on the review page', group: 'apply' },
    { name: 'find_people', label: 'Find people at a company', detail: 'In your field, and the hiring team', group: 'connect' },
    { name: 'send_blank_request', label: 'Send blank connection requests', detail: 'Never with a note', group: 'connect' },
    { name: 'list_new_connections', label: 'Check who accepted', detail: 'Reads your newest connections', group: 'connect' },
    {
      name: 'send_referral_message',
      label: 'Send your referral message',
      detail: 'The app types your saved wording and attaches your resume',
      group: 'connect',
      asksFirst: 'Your approved wording only',
    },
  ],
  wellfound: [
    { name: 'search_jobs', label: 'Search jobs', detail: 'The search saved on your Wellfound account, newest first', group: 'find' },
    { name: 'read_job', label: 'Read a posting', detail: 'Pay, equity, size, description', group: 'find' },
    {
      name: 'apply',
      label: 'Apply',
      detail: 'Send the application with a note to the company',
      group: 'apply',
      asksFirst: 'Asks you first: the note is a written answer',
    },
  ],
  instahyre: [
    { name: 'list_matches', label: 'List matched jobs', detail: 'The jobs Instahyre matched to your profile', group: 'find' },
    { name: 'read_job', label: 'Read a posting', detail: 'Pay, experience, description', group: 'find' },
    { name: 'apply', label: 'Apply', detail: 'In one step, with your Instahyre profile', group: 'apply' },
  ],
}

/** Gmail's own tools: the switches in Settings, Portals, Gmail. Read only. */
export const GMAIL_TOOLS: PortalToolInfo[] = [
  { name: 'list_emails', label: 'List your newest emails', detail: 'Sender, subject, date and a line of preview', group: 'read' },
  { name: 'read_email', label: 'Read an email', detail: 'Opens one and reads it, then leaves it read or unread as it was', group: 'read' },
]

/** A site's sign-in, as the app last saw it in Chrome. */
export type SiteState = { site: string; state: 'signed-in' | 'signed-out' | 'unknown'; checked: string | null }

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export const FLOWS = ['hunt', 'apply', 'connect', 'referral', 'email'] as const
export type Flow = (typeof FLOWS)[number]

export const FLOW_NAMES: Record<Flow, string> = {
  hunt: 'Hunt',
  apply: 'Apply',
  connect: 'Connection requests',
  referral: 'Referral messages',
  email: 'Email check',
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

export type RunEventKind = 'step' | 'claude' | 'tool' | 'good' | 'warn' | 'error'

/** One line of a run's activity. */
export type RunEvent = { id: number; at: string; kind: RunEventKind; text: string }

export type RunUsage = { turns: number; inputTokens: number; outputTokens: number; ms: number }

/** One run as the history lists it. */
export type RunSummary = {
  id: number
  flow: Flow
  title: string
  portal: string | null
  opportunityId: number | null
  started: string
  ended: string | null
  status: RunStatus
  result: string | null
  usage: RunUsage
}

export type RunQuery = { flow: string; portal: string; page: number }

export type RunPage = { rows: RunSummary[]; total: number; page: number; pages: number; pageSize: number }

/** One written answer Claude wants to submit: its field, the question as the form words it, the text. */
export type WrittenAnswer = { ref: number; label: string; text: string }

/** A fact filled from Settings, shown on the approval card for reference. */
export type FilledFact = { label: string; value: string }

/** What a run is waiting on the user for. */
export type RunCard =
  | {
      kind: 'approve'
      id: string
      url: string
      title: string
      answers: WrittenAnswer[]
      facts: FilledFact[]
      /** Held part-way through a form of several pages, before the answers are typed, rather than at its submit. */
      isMidForm?: boolean
    }
  | {
      kind: 'handover'
      id: string
      reason: string
      what: 'captcha' | 'sign-in' | 'code' | 'identity' | 'other'
    }
  | {
      kind: 'decision'
      id: string
      title: string
      body: string
      /** The posting's own words, quoted. */
      quote: string | null
      facts: FilledFact[]
      options: { id: string; label: string; hint: string; isPrimary?: boolean }[]
    }
  | {
      kind: 'question'
      id: string
      /** Every question the form asks that has no saved answer, answered together. */
      questions: { question: string; hint: string }[]
      /** Where they come from: the form's page. */
      context: string
    }
  | {
      kind: 'tool-off'
      id: string
      portal: ToolSite
      /** The tool's label, such as "Submit Easy Apply". */
      tool: string
      /** What the user does in Chrome. */
      steps: string[]
    }

/** The answer the user gives a card. */
export type CardAnswer =
  | { kind: 'approve'; texts: string[] }
  | { kind: 'cancel' }
  | { kind: 'resume' }
  | { kind: 'choose'; option: string }
  | { kind: 'answer'; texts: string[]; save: boolean }

/** A tally a run keeps, such as postings added and discarded. */
export type RunCounts = Record<string, number>

export type RunProgress = { label: string; done: number; total: number }

/** How many Claude sessions one run keeps going at once. */
export const AT_ONCE = 5

/** Where one session stands: waiting its turn, working, stopped on a card, or ended. */
export type LaneStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

/**
 * One Claude session inside a run, with its own Chrome tab: a portal in a
 * hunt, a row in an apply, a company in the referral track.
 */
export type RunLane = {
  key: string
  title: string
  subtitle: string | null
  portal: string | null
  opportunityId: number | null
  status: LaneStatus
  started: string | null
  ended: string | null
  progress: RunProgress | null
  counts: RunCounts
  /** What it waits on the user for. Sessions waiting on the same sign-in share one card. */
  card: RunCard | null
  events: RunEvent[]
  /** The last thing it did, for its tile. */
  last: string | null
  usage: RunUsage
  result: string | null
}

/** The run in progress, or the last one, as its screen shows it. */
export type RunState = {
  id: number
  flow: Flow
  title: string
  subtitle: string | null
  portal: string | null
  opportunityId: number | null
  status: RunStatus
  started: string
  model: string | null
  /** With one session, its progress; with several, how many have ended. */
  progress: RunProgress | null
  /** Summed over every session. */
  counts: RunCounts
  /** A card some session waits on; each session's own is on its lane. */
  card: RunCard | null
  /** Every session's activity, newest last; with several, each line names its session. */
  events: RunEvent[]
  usage: RunUsage
  result: string | null
  /** One per session. A run with one session works in the tab Chrome shows. */
  lanes: RunLane[]
  /** How many sessions run at once. */
  atOnce: number
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

export type NeedsYou = {
  id: string
  icon: 'sign-in' | 'users' | 'chat' | 'hand' | 'warning'
  title: string
  body: string
  action: { label: string; to: string }
}

export type HomeSummary = {
  counts: Record<string, number>
  /** Companies in the tracker. */
  companyCount: number
  nextFound: TrackerRow | null
  foundCount: number
  contactCounts: Record<ContactState, number>
  pendingCompanies: number
  needsYou: NeedsYou[]
  recentRuns: RunSummary[]
  lastHunt: RunSummary | null
  email: EmailSummary
}

/** Fixed facts about the app's Chrome. */
export type BrowserInfo = {
  chromePath: string | null
  profileDir: string
}

/** Everything the screens show about the app's state, pushed on every change. */
export type AppStatus = {
  claude: ClaudeStatus
  browser: BrowserState
  run: RunState | null
}

/** What Claude found in a resume, for the user to review in onboarding. */
export type ResumeImport = {
  profile: Profile
  targetRoles: string[]
  answers: { question: string; answer: string }[]
  /** Total years of experience, worked out from the roles. */
  years: number | null
}

/** The kinds of data a screen shows; main says which changed so screens reload. */
export type DataTopic = 'opportunities' | 'discarded' | 'contacts' | 'runs' | 'settings' | 'answers' | 'sites' | 'email'

/* ------------------------------------------------------------------ */
/* Email check                                                         */
/* ------------------------------------------------------------------ */

/** The email a change or a waiting job came from. */
export type EmailRef = { subject: string; from: string; date: string; link: string }

/** One change an email check made: a tracker row's status, or a contact's state. */
export type EmailChange = {
  id: number
  runId: number | null
  at: string
  kind: 'row' | 'contact'
  targetId: number
  /** The row's company, or the contact's name. */
  title: string
  /** The row's role, or the contact's company. */
  subtitle: string
  from: string
  to: string
  note: string
  email: EmailRef
  undone: boolean
}

/** An email about a job the tracker does not have, kept for the user. */
export type EmailWaiting = {
  id: number
  runId: number | null
  at: string
  company: string
  role: string
  summary: string
  email: EmailRef
  state: 'waiting' | 'added' | 'ignored'
}

/** One email check: what it read and what it changed. */
export type EmailRunDetail = {
  run: RunSummary
  listed: number
  opened: number
  changes: EmailChange[]
  waiting: EmailWaiting[]
}

/** Home's line on the email check. */
export type EmailSummary = { lastRunId: number | null; lastChecked: string | null; moved: number; waiting: number }
