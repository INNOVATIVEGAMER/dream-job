import type {
  Activity,
  AppStatus,
  BrowserInfo,
  CardAnswer,
  ChatState,
  ChatSummary,
  Company,
  CompanyDetail,
  CompanyList,
  CompanyQuery,
  DataTopic,
  EmailRunDetail,
  EmailSettings,
  FormAnswer,
  HomeSummary,
  HuntWindow,
  Job,
  JobOutreach,
  JobRow,
  NeverShowCompany,
  NewJob,
  OutreachState,
  PeopleCount,
  Portal,
  PortalSettings,
  Preferences,
  Profile,
  ReferralMessage,
  ResumeImport,
  ResumeInfo,
  RunEvent,
  RunPage,
  RunQuery,
  RunSummary,
  Settings,
  SignInSite,
  SiteState,
  Source,
  WorkMode,
} from './types'

/** One job's page: the job, its company, its history, and who was asked about it. */
export type JobDetail = { job: Job; company: Company; companyJobs: number; people: PeopleCount; activity: Activity[]; outreach: JobOutreach[] }

export type RunDetail = { summary: RunSummary; events: RunEvent[] }

export type HuntOptions = { portals: Portal[]; window: HuntWindow }
export type ConnectOptions = { companyIds: number[]; perCompany: number }
/** A referral ask: these people, about this job, word for word. */
export type ReferralOptions = { jobId: number; personIds: number[]; resume: boolean }

/**
 * One value of a job, changed on its page. "" clears a text or a link, and
 * null clears a number. A run that reads the posting again may change it back.
 */
export type JobEdit =
  | { field: 'role'; value: string }
  /** A company's name: one in the tracker, or a new one. Asks stay with the job; people stay where they work. */
  | { field: 'company'; value: string }
  | { field: 'reqId'; value: string }
  | { field: 'minYears'; value: number | null }
  | { field: 'score'; value: number | null }
  | { field: 'portal'; value: Source }
  | { field: 'postingLink'; value: string }
  | { field: 'applyLink'; value: string }
  | { field: 'pay'; value: string }
  /** YYYY-MM-DD */
  | { field: 'found'; value: string }

/** One value of a company, changed on its page. "" clears all but the name. */
export type CompanyEdit = { field: 'name' | 'headcount' | 'linkedinUrl' | 'website'; value: string }

/** The only door from the screens to the main process, exposed as `window.jobApp`. */
export type JobAppApi = {
  status: () => Promise<AppStatus>
  onStatus: (listener: (status: AppStatus) => void) => () => void
  onData: (listener: (topics: DataTopic[]) => void) => () => void
  checkClaude: () => Promise<void>
  chrome: {
    open: (mode: 'signin' | 'controlled') => Promise<void>
    close: () => Promise<void>
    front: () => Promise<void>
    openUrl: (url: string) => Promise<void>
    /** Opens a site's sign-in page in Chrome with no control link, where the user types. */
    signIn: (site: SignInSite) => Promise<void>
    info: () => Promise<BrowserInfo>
  }
  home: () => Promise<HomeSummary>
  tracker: {
    /** The tracker, company first: each company with its jobs in the view. */
    companies: (query: CompanyQuery) => Promise<CompanyList>
    get: (id: number) => Promise<JobDetail | null>
    setStatus: (id: number, status: string) => Promise<void>
    setNotes: (id: number, notes: string) => Promise<void>
    setWorkMode: (id: number, workMode: WorkMode) => Promise<void>
    /** Changes one value of the job, as you edit it on its page. */
    edit: (id: number, edit: JobEdit) => Promise<void>
    add: (input: NewJob) => Promise<number>
    /** A discarded job back to found. */
    restore: (id: number) => Promise<void>
  }
  companies: {
    get: (id: number) => Promise<CompanyDetail | null>
    names: () => Promise<{ id: number; name: string }[]>
    setStage: (id: number, stage: string) => Promise<void>
    setNotes: (id: number, notes: string) => Promise<void>
    setNeverShow: (id: number, on: boolean, why?: string) => Promise<void>
    /** Changes one value of the company, as you edit it on its page. */
    edit: (id: number, edit: CompanyEdit) => Promise<void>
    /** Moves everything at one company onto another. */
    merge: (fromId: number, intoId: number) => Promise<void>
    neverShown: () => Promise<NeverShowCompany[]>
    addNeverShow: (company: string, why: string) => Promise<void>
  }
  outreach: {
    /** Where a referral ask stands: you set it. */
    setState: (id: number, state: OutreachState) => Promise<void>
  }
  runs: {
    page: (query: RunQuery) => Promise<RunPage>
    get: (id: number) => Promise<RunDetail | null>
    answer: (cardId: string, answer: CardAnswer) => Promise<void>
    stop: () => Promise<void>
    /** Shows one session's tab in Chrome: by its lane key, or by a card it waits on. */
    showTab: (key: string) => Promise<void>
    /** The jobs a run added: what a hunt found. */
    jobs: (runId: number) => Promise<JobRow[]>
  }
  flows: {
    hunt: (options: HuntOptions) => Promise<number>
    /** One session per job, 5 at a time. */
    apply: (jobIds: number[]) => Promise<number>
    /** Reads found and applied jobs' postings: closed found ones are marked dead, and each keeps the company's link. No ids: all of them. */
    checkPostings: (jobIds: number[]) => Promise<number>
    /** New blank requests at each company: one session per company. */
    connect: (options: ConnectOptions) => Promise<number>
    /** Reads the user's LinkedIn connections at each company: adds them, and marks requests that were accepted. One session per company. */
    refreshPeople: (companyIds: number[]) => Promise<number>
    /** The referral message to these people, about this job. */
    referral: (options: ReferralOptions) => Promise<number>
    checkAccepted: () => Promise<number>
    /** The email check; `count` overrides the setting for this one check. */
    email: (options: { count?: number }) => Promise<number>
  }
  email: {
    detail: (runId: number) => Promise<EmailRunDetail | null>
    /** Undoes one change an email made: its Activity row's id. */
    undo: (activityId: number) => Promise<void>
  }
  chat: {
    /** The open chat. */
    state: () => Promise<ChatState>
    onState: (listener: (state: ChatState) => void) => () => void
    /** Claude asks the screens to show a path, such as `/job/12`. */
    onNavigate: (listener: (path: string) => void) => () => void
    list: () => Promise<ChatSummary[]>
    open: (id: number) => Promise<void>
    /** An empty chat; the first message starts it. */
    startNew: () => Promise<void>
    /** A message, with the path of the screen the user is on. */
    send: (text: string, route: string) => Promise<void>
    stop: () => Promise<void>
    answer: (cardId: string, answer: CardAnswer) => Promise<void>
    remove: (id: number) => Promise<void>
    /** Shows the chat's own Chrome tab. */
    showTab: () => Promise<void>
    /** The model for the open chat; null follows the default in Settings. */
    setModel: (model: string | null) => Promise<void>
  }
  settings: {
    get: () => Promise<Settings>
    setPreferences: (value: Preferences) => Promise<void>
    setProfile: (value: Profile) => Promise<void>
    setReferral: (value: ReferralMessage) => Promise<void>
    setPortals: (value: PortalSettings) => Promise<void>
    setEmail: (value: EmailSettings) => Promise<void>
    /** The model runs and new chats use: a value from Claude Code's list, or `default`. */
    setModel: (model: string) => Promise<void>
    finishSetup: () => Promise<void>
    answers: () => Promise<FormAnswer[]>
    saveAnswer: (question: string, answer: string) => Promise<void>
    removeAnswer: (id: number) => Promise<void>
    sites: () => Promise<SiteState[]>
    chooseResume: () => Promise<ResumeInfo | null>
    removeResume: () => Promise<void>
    openResume: () => Promise<void>
    importResume: () => Promise<ResumeImport>
  }
}

/** Every request channel, as `area:method`; the preload and the main process both build from this list. */
export const CHANNELS = [
  'status',
  'checkClaude',
  'chrome:open',
  'chrome:close',
  'chrome:front',
  'chrome:openUrl',
  'chrome:signIn',
  'chrome:info',
  'home',
  'tracker:companies',
  'tracker:get',
  'tracker:setStatus',
  'tracker:setNotes',
  'tracker:setWorkMode',
  'tracker:edit',
  'tracker:add',
  'tracker:restore',
  'companies:get',
  'companies:names',
  'companies:setStage',
  'companies:setNotes',
  'companies:setNeverShow',
  'companies:edit',
  'companies:merge',
  'companies:neverShown',
  'companies:addNeverShow',
  'outreach:setState',
  'runs:page',
  'runs:get',
  'runs:answer',
  'runs:stop',
  'runs:showTab',
  'runs:jobs',
  'flows:hunt',
  'flows:apply',
  'flows:checkPostings',
  'flows:connect',
  'flows:refreshPeople',
  'flows:referral',
  'flows:checkAccepted',
  'flows:email',
  'email:detail',
  'email:undo',
  'chat:state',
  'chat:list',
  'chat:open',
  'chat:startNew',
  'chat:send',
  'chat:stop',
  'chat:answer',
  'chat:remove',
  'chat:showTab',
  'chat:setModel',
  'settings:get',
  'settings:setPreferences',
  'settings:setProfile',
  'settings:setReferral',
  'settings:setPortals',
  'settings:setEmail',
  'settings:setModel',
  'settings:finishSetup',
  'settings:answers',
  'settings:saveAnswer',
  'settings:removeAnswer',
  'settings:sites',
  'settings:chooseResume',
  'settings:removeResume',
  'settings:openResume',
  'settings:importResume',
] as const

export type Channel = (typeof CHANNELS)[number]
