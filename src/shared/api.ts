import type {
  AppStatus,
  ContactCompanies,
  ContactView,
  Company,
  CompanyDetail,
  CompanyList,
  CompanyQuery,
  BrowserInfo,
  CardAnswer,
  Contact,
  ContactPage,
  ContactQuery,
  DataTopic,
  DiscardedPage,
  DiscardedQuery,
  EmailRunDetail,
  EmailSettings,
  EmailWaiting,
  FormAnswer,
  HomeSummary,
  HuntWindow,
  NeverShowCompany,
  NewOpportunity,
  Opportunity,
  OpportunityEvent,
  Portal,
  PortalSettings,
  Preferences,
  Profile,
  ReadyCompany,
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
  TrackerPage,
  TrackerQuery,
  TrackerRow,
  WorkMode,
} from './types'

export type OpportunityDetail = { opportunity: Opportunity; events: OpportunityEvent[]; contacts: Contact[]; company: Company | null; companyJobs: number }

export type RunDetail = { summary: RunSummary; events: RunEvent[] }

/** A company the user applied to, with where its connection requests stand. */
export type AppliedCompany = {
  company: string
  role: string
  appliedOn: string
  opportunityId: number
  pending: number
  accepted: number
  total: number
}

export type HuntOptions = { portals: Portal[]; window: HuntWindow }
export type ConnectOptions = { companies: string[]; perCompany: number }
export type ReferralOptions = { companies: string[] }

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
    page: (query: TrackerQuery) => Promise<TrackerPage>
    get: (id: number) => Promise<OpportunityDetail | null>
    setStatus: (id: number, status: string) => Promise<void>
    setNotes: (id: number, notes: string) => Promise<void>
    setWorkMode: (id: number, workMode: WorkMode) => Promise<void>
    /** The links the user pastes: the posting where it was found, and where the application goes. "" clears one. */
    setLinks: (id: number, links: { postingLink: string; applyLink: string }) => Promise<void>
    add: (input: NewOpportunity & { status: string }) => Promise<number>
    /** The tracker, company first: each company with its jobs in the view. */
    companies: (query: CompanyQuery) => Promise<CompanyList>
  }
  companies: {
    get: (id: number) => Promise<CompanyDetail | null>
    names: () => Promise<{ id: number; name: string }[]>
    setStage: (id: number, stage: string) => Promise<void>
    setNotes: (id: number, notes: string) => Promise<void>
    setNeverShow: (id: number, on: boolean, why?: string) => Promise<void>
    rename: (id: number, name: string) => Promise<void>
    /** Moves everything at one company onto another. */
    merge: (fromId: number, intoId: number) => Promise<void>
  }
  discarded: {
    page: (query: DiscardedQuery) => Promise<DiscardedPage>
    restore: (id: number) => Promise<number>
    neverShow: () => Promise<NeverShowCompany[]>
    addNeverShow: (company: string, why: string) => Promise<void>
    removeNeverShow: (id: number) => Promise<void>
  }
  contacts: {
    /** Contacts, company first. */
    byCompany: (view: ContactView, search: string) => Promise<ContactCompanies>
    page: (query: ContactQuery) => Promise<ContactPage>
    ready: () => Promise<ReadyCompany[]>
    applied: () => Promise<AppliedCompany[]>
    get: (id: number) => Promise<Contact | null>
    markThanked: (id: number) => Promise<void>
  }
  runs: {
    page: (query: RunQuery) => Promise<RunPage>
    get: (id: number) => Promise<RunDetail | null>
    answer: (cardId: string, answer: CardAnswer) => Promise<void>
    stop: () => Promise<void>
    /** Shows one session's tab in Chrome: by its lane key, or by a card it waits on. */
    showTab: (key: string) => Promise<void>
    /** The jobs a run added: what a hunt found. */
    jobs: (runId: number) => Promise<TrackerRow[]>
  }
  flows: {
    hunt: (options: HuntOptions) => Promise<number>
    /** One session per row, 5 at a time. */
    apply: (opportunityIds: number[]) => Promise<number>
    /** Reads found jobs' apply pages: closed ones are marked dead, and each keeps the company's link. No ids: every found job. */
    checkPostings: (opportunityIds: number[]) => Promise<number>
    connect: (options: ConnectOptions) => Promise<number>
    referral: (options: ReferralOptions) => Promise<number>
    checkAccepted: () => Promise<number>
    /** The email check; `count` overrides the setting for this one check. */
    email: (options: { count?: number }) => Promise<number>
  }
  email: {
    detail: (runId: number) => Promise<EmailRunDetail | null>
    undo: (changeId: number) => Promise<void>
    waiting: () => Promise<EmailWaiting[]>
    add: (waitingId: number) => Promise<number>
    ignore: (waitingId: number) => Promise<void>
  }
  settings: {
    get: () => Promise<Settings>
    setPreferences: (value: Preferences) => Promise<void>
    setProfile: (value: Profile) => Promise<void>
    setReferral: (value: ReferralMessage) => Promise<void>
    setPortals: (value: PortalSettings) => Promise<void>
    setEmail: (value: EmailSettings) => Promise<void>
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
  'tracker:page',
  'tracker:get',
  'tracker:setStatus',
  'tracker:setNotes',
  'tracker:setWorkMode',
  'tracker:setLinks',
  'tracker:add',
  'tracker:companies',
  'companies:get',
  'companies:names',
  'companies:setStage',
  'companies:setNotes',
  'companies:setNeverShow',
  'companies:rename',
  'companies:merge',
  'discarded:page',
  'discarded:restore',
  'discarded:neverShow',
  'discarded:addNeverShow',
  'discarded:removeNeverShow',
  'contacts:byCompany',
  'contacts:page',
  'contacts:ready',
  'contacts:applied',
  'contacts:get',
  'contacts:markThanked',
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
  'flows:referral',
  'flows:checkAccepted',
  'flows:email',
  'email:detail',
  'email:undo',
  'email:waiting',
  'email:add',
  'email:ignore',
  'settings:get',
  'settings:setPreferences',
  'settings:setProfile',
  'settings:setReferral',
  'settings:setPortals',
  'settings:setEmail',
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
