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

/**
 * A job's life: found by a hunt or by you, or discarded when a hunt rules it
 * out; then applied, outreached once its first referral message goes,
 * referred when someone refers you, interview, and an end. Steps can be
 * skipped, and rejected or dead can end a job at any stage.
 */
export const STATUSES = ['found', 'discarded', 'applied', 'outreached', 'referred', 'interview', 'offer', 'rejected', 'dead'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_NAMES: Record<Status, string> = {
  found: 'Found',
  discarded: 'Discarded',
  applied: 'Applied',
  outreached: 'Outreached',
  referred: 'Referred',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  dead: 'Dead',
}

export const isStatus = (value: string): value is Status => (STATUSES as readonly string[]).includes(value)

/** Past applying and still in play: referral asks and connection requests point at these. */
export const ACTIVE_STATUSES: readonly Status[] = ['applied', 'outreached', 'referred', 'interview', 'offer']

export const STAGES = ['startup', 'scaleup', 'large'] as const
export type Stage = (typeof STAGES)[number]

/** The portals the app drives. */
export const PORTALS = ['linkedin', 'wellfound', 'instahyre', 'jsgurujobs', 'onlyfrontendjobs', 'workatastartup', 'weekday'] as const
export type Portal = (typeof PORTALS)[number]

/** Where a job came from: one of the portals, or added by you. */
export const SOURCES = [...PORTALS, 'manual'] as const
export type Source = (typeof SOURCES)[number]

export const isSource = (value: string): value is Source => (SOURCES as readonly string[]).includes(value)

/** Portals whose own tools are built so far; the hunt runs only on these. */
export const HUNT_PORTALS: readonly Portal[] = PORTALS

export const PORTAL_NAMES: Record<Portal, string> = {
  linkedin: 'LinkedIn',
  wellfound: 'Wellfound',
  instahyre: 'Instahyre',
  jsgurujobs: 'JSGuruJobs',
  onlyfrontendjobs: 'OnlyFrontendJobs',
  workatastartup: 'Work at a Startup',
  weekday: 'Weekday',
}

export const SOURCE_NAMES: Record<Source, string> = { ...PORTAL_NAMES, manual: 'Added by you' }

/**
 * The sites the user signs in to in the app's Chrome: Google, for "Continue
 * with Google", and each portal that needs an account. OnlyFrontendJobs is
 * read signed out.
 */
export const SIGN_IN_SITES = ['google', 'linkedin', 'wellfound', 'instahyre', 'jsgurujobs', 'workatastartup', 'weekday'] as const
export type SignInSite = (typeof SIGN_IN_SITES)[number]

export const SIGN_IN_URLS: Record<SignInSite, string> = {
  google: 'https://accounts.google.com/',
  linkedin: 'https://www.linkedin.com/login',
  wellfound: 'https://wellfound.com/login',
  instahyre: 'https://www.instahyre.com/login/',
  jsgurujobs: 'https://jsgurujobs.com/login',
  workatastartup: 'https://www.workatastartup.com/',
  weekday: 'https://jobs.weekday.works/',
}

export const SITE_NAMES: Record<SignInSite, string> = { google: 'Google', ...PORTAL_NAMES }

/** Whether a site has a sign-in of its own: every portal but OnlyFrontendJobs. */
export const isSignInSite = (site: string): site is SignInSite => (SIGN_IN_SITES as readonly string[]).includes(site)

/** The sites Claude works in through the app's own tools: the portals, and Gmail for the email check. */
export type ToolSite = Portal | 'gmail'

export const TOOL_SITE_NAMES: Record<ToolSite, string> = { ...PORTAL_NAMES, gmail: 'Gmail' }

/**
 * A job's work mode as a fixed label, for the tracker's badge and filter.
 * Hunts keep every mode; the user's preference only picks the searches and
 * the tracker's default filter.
 */
export const WORK_MODES = ['remote', 'hybrid', 'onsite', 'not-stated'] as const
export type WorkMode = (typeof WORK_MODES)[number]

export const WORK_MODE_NAMES: Record<WorkMode, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', 'not-stated': 'Not stated' }

/** Reads the label from a free-text mode such as "Hybrid, Bengaluru". Says not-stated rather than guess. */
export function workModeOf(text: string): WorkMode {
  const value = text.toLowerCase()
  if (/not stated|unknown/.test(value)) return 'not-stated'
  if (/hybrid/.test(value)) return 'hybrid'
  if (/remote|work from home|\bwfh\b|anywhere/.test(value)) return 'remote'
  if (/on-?site|in[- ]office|\bwfo\b|work from office/.test(value)) return 'onsite'
  return 'not-stated'
}

/** Whether the posting was open the last time a run read it, or could not be read. */
export type PostingState = 'open' | 'closed' | 'unreadable'

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

/** One job as the tracker's rows show it. Its company's name comes from Companies. */
export type JobRow = {
  id: number
  companyId: number
  company: string
  role: string
  status: Status
  portal: Source
  /** Where the application goes. */
  link: string | null
  /** The posting on its portal; how a hunt recognises a posting it has seen. */
  portalLink: string | null
  postingState: PostingState | null
  workMode: WorkMode
  /** The fewest years of experience the job asks for, read from the posting; null when it doesn't say or hasn't been read. */
  minYears: number | null
  score: number | null
  /** Why a hunt ruled it out, for a discarded job. */
  discardReason: DiscardReason | null
  /** The posting's own words that ruled it out, quoted exactly. */
  discardLine: string | null
  /** When anything last happened to it: its newest Activity row. */
  updated: string
}

/** Everything about one job, for its own page. */
export type Job = JobRow & {
  found: string
  /** The company's own id for the job, as the posting states it; referral messages include it. */
  reqId: string | null
  applyRoute: string | null
  postingChecked: string | null
  postingNote: string | null
  pay: string | null
  applicants: string
  scoreReasons: string[]
  notes: string
}

/** A job you add by hand, such as one a recruiter called about. It needs a link. */
export type NewJob = {
  company: string
  stage: Stage
  role: string
  link: string
  reqId: string
  status: Status
  portal: Source
  workMode?: WorkMode
  notes: string
}

/* ------------------------------------------------------------------ */
/* Companies: what every job, person and email belongs to              */
/* ------------------------------------------------------------------ */

/** The tracker's views, each a set of job statuses. All leaves out Discarded. */
export const TRACKER_VIEWS = ['found', 'applied', 'outreached', 'referred', 'interview', 'offer', 'closed', 'discarded', 'all'] as const
export type TrackerView = (typeof TRACKER_VIEWS)[number]

export const VIEW_STATUSES: Record<TrackerView, readonly Status[]> = {
  found: ['found'],
  applied: ['applied'],
  outreached: ['outreached'],
  referred: ['referred'],
  interview: ['interview'],
  offer: ['offer'],
  closed: ['rejected', 'dead'],
  discarded: ['discarded'],
  all: STATUSES.filter(status => status !== 'discarded'),
}

export const TRACKER_VIEW_NAMES: Record<TrackerView, string> = {
  found: 'Found',
  applied: 'Applied',
  outreached: 'Outreached',
  referred: 'Referred',
  interview: 'Interview',
  offer: 'Offer',
  closed: 'Closed',
  discarded: 'Discarded',
  all: 'All',
}

/**
 * The statuses Check postings reads: jobs waiting to be applied to, and jobs
 * applied to that haven't reached an interview. A closed posting kills a
 * found job, but only gets a note on one already applied to.
 */
export const CHECK_STATUSES: readonly Status[] = ['found', 'applied', 'outreached', 'referred']

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

/** Who you know at a company now: connections, and requests still out. */
export type PeopleCount = { connected: number; requested: number }

/** One company as the tracker lists it, with the jobs the view shows. */
export type CompanyRow = {
  id: number
  name: string
  stage: string
  /** The status of its job furthest along; a closed job counts only when all are closed. */
  status: Status
  bestScore: number | null
  updated: string
  /** All its jobs, whatever the view. */
  jobCount: number
  people: PeopleCount
  neverShow: boolean
  jobs: JobRow[]
}

/** `modes` empty means every work mode. */
export type CompanyQuery = { view: TrackerView; stage: string; portal: string; search: string; modes: WorkMode[] }

export type CompanyList = {
  companies: CompanyRow[]
  /** Companies in each view. */
  counts: Record<TrackerView, number>
  totalCompanies: number
  totalJobs: number
  discardedJobs: number
}

/** One person at a company, as its page lists them: where they stand, and what each was asked. */
export type CompanyPerson = Person & {
  /** Whether they work there now; people who left stay listed after the current ones. */
  current: boolean
  /** When the request went, for someone not connected yet. */
  requested: string | null
  asked: { outreachId: number; jobId: number; role: string; state: OutreachState; sent: string }[]
}

export type CompanyDetail = { company: Company; jobs: JobRow[]; people: CompanyPerson[]; activity: Activity[] }

export type NeverShowCompany = { id: number; company: string; why: string; added: string }

/* ------------------------------------------------------------------ */
/* People, where they work, and what they were asked                   */
/* ------------------------------------------------------------------ */

/** The LinkedIn connection: a request sent, or connected. It follows the person wherever they work. */
export const PERSON_STATES = ['requested', 'connected'] as const
export type PersonState = (typeof PERSON_STATES)[number]

export const PERSON_STATE_NAMES: Record<PersonState, string> = { requested: 'Request sent', connected: 'Connected' }

/** New connection requests one click sends at each company. */
export const REQUESTS_PER_COMPANY = 10

export type Person = {
  id: number
  name: string
  headline: string
  profileUrl: string
  state: PersonState
}

/** Where a person works: one row per person and company. A move adds one; leaving closes it. */
export type Position = { personId: number; companyId: number; current: boolean }

/** Where a referral ask stands. You set it; the email check leaves it alone. */
export const OUTREACH_STATES = ['sent', 'replied', 'referred', 'declined'] as const
export type OutreachState = (typeof OUTREACH_STATES)[number]

export const OUTREACH_STATE_NAMES: Record<OutreachState, string> = { sent: 'Sent', replied: 'Replied', referred: 'Referred', declined: 'Declined' }

/** One referral message: a person at a company, asked about one of its jobs. */
export type Outreach = {
  id: number
  jobId: number
  personId: number
  message: string
  resume: boolean
  state: OutreachState
  sent: string
}

/** An ask as a job's page lists it, with the person it went to. */
export type JobOutreach = Outreach & { name: string; headline: string; profileUrl: string; current: boolean }

/* ------------------------------------------------------------------ */
/* Activity: what happened, and what caused it                         */
/* ------------------------------------------------------------------ */

export const ACTIVITY_KINDS = ['status', 'request-sent', 'connected', 'outreach', 'joined', 'left', 'note'] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** One thing that happened to a job, a person or an outreach, with the run or email that caused it. */
export type Activity = {
  id: number
  at: string
  kind: ActivityKind
  jobId: number | null
  personId: number | null
  /** For a person's rows, the company it happened at. */
  companyId: number | null
  fromState: string | null
  toState: string | null
  text: string
  runId: number | null
  emailId: number | null
  undone: boolean
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
  /** The approved wording, with {name}, {role}, {company}, {job id} and {job link} slots. A line with {job id} drops out when the job has none. */
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
    { name: 'company_connections', label: 'Read your connections at a company', detail: 'Adds them, and marks accepted requests', group: 'connect' },
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
  jsgurujobs: [
    { name: 'search_jobs', label: 'Search jobs', detail: 'By country and work mode, newest first', group: 'find' },
    { name: 'read_job', label: 'Read a posting', detail: "Place, mode, pay, description, and the company's apply page it leads to", group: 'find' },
  ],
  onlyfrontendjobs: [
    { name: 'search_jobs', label: 'Search jobs', detail: 'Remote or all frontend roles, newest first', group: 'find' },
    { name: 'read_job', label: 'Read a posting', detail: "Place, regions, years asked, description, and the company's apply page", group: 'find' },
  ],
  workatastartup: [
    { name: 'search_jobs', label: 'Search jobs', detail: 'Engineering roles at YC startups, newest first', group: 'find' },
    { name: 'read_job', label: 'Read a posting', detail: 'Place, visa, pay, years asked, the company, and whether you applied', group: 'find' },
    {
      name: 'open_apply',
      label: 'Open the application',
      detail: "Opens the posting's Apply form and reads its fields",
      group: 'apply',
      asksFirst: 'Your message to the founders and written answers wait for you',
    },
  ],
  weekday: [
    { name: 'search_jobs', label: 'List jobs', detail: 'From the filters saved on your Weekday account', group: 'find' },
    { name: 'read_job', label: 'Read a posting', detail: 'Place, years asked, skills, description, and where it applies', group: 'find' },
    { name: 'apply', label: 'Apply on Weekday', detail: 'Hands you the Apply press in Chrome, then checks it went through', group: 'apply', asksFirst: 'You press Apply' },
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

export const FLOWS = ['hunt', 'apply', 'check', 'connect', 'referral', 'email'] as const
export type Flow = (typeof FLOWS)[number]

export const FLOW_NAMES: Record<Flow, string> = {
  hunt: 'Hunt',
  apply: 'Apply',
  check: 'Posting checks',
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
  jobId: number | null
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
  jobId: number | null
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
  jobId: number | null
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
  foundCount: number
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
export type DataTopic = 'jobs' | 'people' | 'runs' | 'settings' | 'answers' | 'sites' | 'email'

/* ------------------------------------------------------------------ */
/* Email check                                                         */
/* ------------------------------------------------------------------ */

/** An email, as a change names it. */
export type EmailRef = { subject: string; from: string; date: string; link: string }

/** What the check did with an email: skipped (not about anything you track) or matched (about a job or a person you track). */
export const EMAIL_OUTCOMES = ['skipped', 'matched'] as const
export type EmailOutcome = (typeof EMAIL_OUTCOMES)[number]

/** One change an email check made, from the Activity rows that name their email. */
export type EmailChange = {
  /** The Activity row's id: undoing the change undoes it. */
  id: number
  at: string
  kind: 'job' | 'person'
  targetId: number
  /** The job's company, or the person's name. */
  title: string
  /** The job's role, or the person's company. */
  subtitle: string
  from: string
  to: string
  note: string
  email: EmailRef
  undone: boolean
}

/** One email check: what it read and what it changed. */
export type EmailRunDetail = {
  run: RunSummary
  /** Emails it looked at. */
  listed: number
  /** Of those, about a job or person you track. */
  matched: number
  changes: EmailChange[]
}

/** Home's line on the email check. */
export type EmailSummary = { lastRunId: number | null; lastChecked: string | null; moved: number }
