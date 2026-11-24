import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import type { CompanyEdit, JobDetail, JobEdit } from '../../shared/api'
import { cleanLink } from '../../shared/links'
import { askBlock, experienceFit, experienceMonths } from '../../shared/profile'
import { isUndisclosed } from '../../shared/referral'
import { ACTIVE_STATUSES, EMPLOYERS, EXPERIENCE_FITS, SOURCES, STAGES, TRACKER_VIEWS, VIEW_STATUSES, WORK_MODES } from '../../shared/types'
import type {
  CompanyDetail,
  CompanyList,
  CompanyPerson,
  CompanyQuery,
  CompanyRow,
  EmailChange,
  EmailRunDetail,
  EmailSummary,
  HomeSummary,
  JobRow,
  NeedsYou,
  OutreachState,
  PersonState,
  TrackerView,
} from '../../shared/types'
import { ActivityLog } from './activity'
import { Chats } from './chats'
import { Companies, furthest, NeverShow } from './companies'
import { openDatabase } from './database'
import { Emails } from './emails'
import { changeLine, JOB_FROM, JOB_ROW, Jobs, toRow } from './jobs'
import { OutreachStore } from './outreach'
import { People } from './people'
import { Runs } from './runs'
import { SettingsStore } from './settings'

/**
 * Everything the app keeps, in one database with one owner (the main
 * process), and one object per kind of record. What spans several of them,
 * such as a company's page or recording a referral ask, lives here.
 */
export class Store {
  readonly companies: Companies
  readonly activity: ActivityLog
  readonly jobs: Jobs
  readonly people: People
  readonly outreach: OutreachStore
  readonly emails: Emails
  readonly runs: Runs
  readonly settings: SettingsStore
  readonly neverShow: NeverShow
  readonly chats: Chats

  private constructor(private readonly db: DatabaseSync) {
    this.companies = new Companies(db)
    this.activity = new ActivityLog(db)
    this.jobs = new Jobs(db, this.companies, this.activity)
    this.people = new People(db, this.companies, this.activity)
    this.outreach = new OutreachStore(db)
    this.emails = new Emails(db)
    this.runs = new Runs(db)
    this.settings = new SettingsStore(db)
    this.neverShow = new NeverShow(this.companies)
    this.chats = new Chats(db)
  }

  static open(path: string): Store {
    return new Store(openDatabase(path))
  }

  /** Runs several writes as one: all of them or none. */
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Why no one may be asked for a referral to this job, by the user's experience now, or null when they may. */
  askBlock(job: Pick<JobRow, 'minYears'>): string | null {
    return askBlock(job.minYears, experienceMonths(this.settings.profile()))
  }

  /**
   * A company's jobs the user may ask about, newest first: none asks more than
   * a year past their experience, and none at a client a recruiting firm doesn't name.
   */
  private askableAt(companyId: number): JobRow[] {
    const company = this.companies.get(companyId)
    if (!company || isUndisclosed(company.name)) return []
    const months = experienceMonths(this.settings.profile())
    return this.jobs.forCompany(companyId).filter(row => !askBlock(row.minYears, months))
  }

  /** The job a referral at this company points at: the newest one still in play after applying that the user may ask about. */
  appliedJob(companyId: number): JobRow | null {
    return this.askableAt(companyId).find(row => ACTIVE_STATUSES.includes(row.status)) ?? null
  }

  /**
   * The job connection requests at this company are for: the applied one, or
   * else the newest found one, of those the user may ask about. With none,
   * no requests go there: nobody there would ever be asked.
   */
  connectJob(companyId: number): JobRow | null {
    const askable = this.askableAt(companyId)
    return askable.find(row => ACTIVE_STATUSES.includes(row.status)) ?? askable.find(row => row.status === 'found') ?? null
  }

  /* ---------------------------------------------------------------- edits on a page */

  /** One value of a job, changed on its page; the company moves it, the rest is the job's own. */
  editJob(jobId: number, change: JobEdit): void {
    this.transaction(() => {
      if (change.field === 'company') this.moveJob(jobId, change.value)
      else this.jobs.edit(jobId, change)
    })
  }

  /**
   * Moves a job to another company, one in the tracker or a new one, which
   * starts at the old one's stage. Its asks stay with the job; people stay
   * where they work, so the old company keeps them.
   */
  private moveJob(jobId: number, name: string): void {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error(`no job with id ${jobId}`)
    const from = this.companies.get(job.companyId)
    const companyId = this.companies.resolve(name, from?.stage)
    if (companyId === job.companyId) return
    const to = this.companies.get(companyId)
    this.jobs.setCompany(jobId, companyId)
    this.activity.add({ kind: 'edit', jobId, text: `You moved it from ${job.company} to ${to?.name ?? name.trim()}` })
  }

  /** One value of a company, changed on its page, with a line in its history. */
  editCompany(companyId: number, change: CompanyEdit): void {
    const company = this.companies.get(companyId)
    if (!company) throw new Error(`no company with id ${companyId}`)
    const value = change.value.trim()
    this.transaction(() => {
      if (change.field === 'name') {
        if (value === company.name) return
        this.companies.rename(companyId, value)
        this.activity.add({ kind: 'edit', companyId, text: changeLine('the name', company.name, value) })
        return
      }
      const isLink = change.field !== 'headcount'
      if (isLink && value && !/^https?:\/\/\S+$/i.test(value)) throw new Error('Paste the whole link, starting with https://')
      const next = isLink && value ? cleanLink(value) : value
      const before = company[change.field] ?? ''
      if (before === next) return
      this.companies.setDetail(companyId, change.field, next || null)
      const what = { headcount: 'how many people work there', linkedinUrl: 'the LinkedIn page', website: 'the website' }[change.field]
      this.activity.add({ kind: 'edit', companyId, text: changeLine(what, before, next) })
    })
  }

  /* ---------------------------------------------------------------- tracker */

  /** The tracker: one entry per company with jobs in the view, each with those jobs. */
  trackerList(query: CompanyQuery): CompanyList {
    const statuses = VIEW_STATUSES[query.view]
    const where = [`j.status IN (${statuses.map(() => '?').join(', ')})`]
    const params: SQLInputValue[] = [...statuses]
    // Each list empty, or holding every choice, filters nothing.
    const stages = query.stages.filter(stage => (STAGES as readonly string[]).includes(stage))
    if (stages.length && stages.length < STAGES.length) {
      where.push(`c.stage IN (${stages.map(() => '?').join(', ')})`)
      params.push(...stages)
    }
    const portals = query.portals.filter(portal => (SOURCES as readonly string[]).includes(portal))
    if (portals.length && portals.length < SOURCES.length) {
      where.push(`j.portal IN (${portals.map(() => '?').join(', ')})`)
      params.push(...portals)
    }
    const modes = query.modes.filter(mode => (WORK_MODES as readonly string[]).includes(mode))
    if (modes.length && modes.length < WORK_MODES.length) {
      where.push(`j.work_mode IN (${modes.map(() => '?').join(', ')})`)
      params.push(...modes)
    }
    if (query.starred !== null) where.push(`j.starred = ${query.starred ? 1 : 0}`)
    const search = query.search.trim().toLowerCase()
    if (search) {
      where.push('(lower(c.name) LIKE ? OR lower(j.role) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    // Employer and experience go by the same rules that stop outreach, so they are read here rather than in SQL.
    const employers = query.employers.filter(one => (EMPLOYERS as readonly string[]).includes(one))
    const fits = query.experience.filter(one => (EXPERIENCE_FITS as readonly string[]).includes(one))
    const months = fits.length ? experienceMonths(this.settings.profile()) : null
    const shown = this.db
      .prepare(`SELECT ${JOB_ROW} FROM ${JOB_FROM} WHERE ${where.join(' AND ')} ORDER BY updated DESC, j.id DESC`)
      .all(...params)
      .map(toRow)
      .filter(job => !employers.length || employers.includes(isUndisclosed(job.company) ? 'undisclosed' : 'named'))
      .filter(job => !fits.length || fits.includes(experienceFit(job.minYears, months)))

    const byCompany = new Map<number, JobRow[]>()
    for (const job of shown) byCompany.set(job.companyId, [...(byCompany.get(job.companyId) ?? []), job])
    const ids = [...byCompany.keys()]
    const all = new Map<number, JobRow[]>()
    if (ids.length) {
      for (const row of this.db.prepare(`SELECT ${JOB_ROW} FROM ${JOB_FROM} WHERE j.company_id IN (${ids.map(() => '?').join(', ')})`).all(...ids)) {
        const job = toRow(row)
        all.set(job.companyId, [...(all.get(job.companyId) ?? []), job])
      }
    }
    const people = this.people.counts(ids)

    const companies: CompanyRow[] = ids.map(id => {
      const own = all.get(id) ?? []
      const live = own.filter(job => job.status !== 'discarded')
      const counted = live.length ? live : own
      const company = this.companies.get(id)!
      return {
        id,
        name: company.name,
        stage: company.stage,
        status: live.length ? furthest(live.map(job => job.status)) : 'discarded',
        bestScore: counted.reduce<number | null>((best, job) => (job.score !== null && (best === null || job.score > best) ? job.score : best), null),
        updated: own.reduce((latest, job) => (job.updated > latest ? job.updated : latest), ''),
        jobCount: counted.length,
        people: people.get(id) ?? { connected: 0, requested: 0 },
        neverShow: company.neverShow,
        jobs: byCompany.get(id)!,
      }
    })

    const counts = {} as Record<TrackerView, number>
    for (const view of TRACKER_VIEWS) {
      const set = VIEW_STATUSES[view]
      counts[view] = Number((this.db.prepare(`SELECT COUNT(DISTINCT company_id) AS n FROM jobs WHERE status IN (${set.map(() => '?').join(', ')})`).get(...set) as { n: number }).n)
    }
    const jobCounts = this.jobs.counts()
    const discardedJobs = jobCounts['discarded'] ?? 0
    const totalJobs = Object.values(jobCounts).reduce((sum, n) => sum + n, 0) - discardedJobs
    return { companies, counts, totalCompanies: this.companies.count(), totalJobs, discardedJobs }
  }

  /* ---------------------------------------------------------------- pages */

  /** One company's page: its jobs, everyone who works or worked there with what each was asked, and its history. */
  companyDetail(id: number): CompanyDetail | null {
    const company = this.companies.get(id)
    if (!company) return null
    const asks = this.outreach.forCompany(id)
    const people: CompanyPerson[] = this.people.atCompany(id).map(person => ({
      ...person,
      requested: person.state === 'requested' ? this.activity.requestedOn(person.id) : null,
      asked: asks
        .filter(ask => ask.personId === person.id)
        .map(ask => ({ outreachId: ask.id, jobId: ask.jobId, role: ask.role, state: ask.state, sent: ask.sent })),
    }))
    return { company, jobs: this.jobs.forCompany(id), people, activity: this.activity.forCompany(id) }
  }

  /** One job's page: the job, its company, its history, and who was asked about it. */
  jobDetail(id: number): JobDetail | null {
    const job = this.jobs.get(id)
    if (!job) return null
    const company = this.companies.get(job.companyId)
    if (!company) return null
    return {
      job,
      company,
      companyJobs: this.jobs.forCompany(company.id).filter(row => row.status !== 'discarded').length,
      people: this.people.counts([company.id]).get(company.id) ?? { connected: 0, requested: 0 },
      activity: this.activity.forJob(id),
      outreach: this.outreach.forJob(id),
    }
  }

  /* ---------------------------------------------------------------- outreach */

  /**
   * Records a referral message that went: its Outreach row, the line in
   * Activity, and the job moving to outreached if this was its first ask.
   */
  recordOutreach(entry: { jobId: number; personId: number; message: string; resume: boolean }, runId: number | null): number {
    return this.transaction(() => {
      const job = this.jobs.row(entry.jobId)
      const person = this.people.get(entry.personId)
      if (!job || !person) throw new Error('That job or person is no longer kept.')
      const id = this.outreach.add(entry)
      this.activity.add({ kind: 'outreach', jobId: job.id, personId: person.id, companyId: job.companyId, toState: 'sent', text: `Asked ${person.name} about ${job.role}`, runId })
      if (job.status === 'applied') this.jobs.setStatus(job.id, 'outreached', { runId, text: 'Outreached: the first referral message went' })
      return id
    })
  }

  /** Where a referral ask stands, as you set it. A referral moves its job to referred. */
  setOutreachState(id: number, state: OutreachState): void {
    this.transaction(() => {
      const ask = this.outreach.get(id)
      if (!ask) throw new Error('That ask is no longer kept.')
      if (ask.state === state) return
      const job = this.jobs.row(ask.jobId)
      const person = this.people.get(ask.personId)
      this.outreach.setState(id, state)
      const name = person?.name ?? 'Someone'
      const said: Record<OutreachState, string> = {
        sent: `${name}: back to sent`,
        replied: `${name} replied`,
        referred: `${name} referred you`,
        declined: `${name} declined`,
      }
      this.activity.add({ kind: 'outreach', jobId: ask.jobId, personId: ask.personId, companyId: job?.companyId ?? null, fromState: ask.state, toState: state, text: `${said[state]}: set by you` })
      if (state === 'referred' && job && (job.status === 'applied' || job.status === 'outreached')) {
        this.jobs.setStatus(job.id, 'referred', { text: `Referred by ${name}` })
      }
    })
  }

  /* ---------------------------------------------------------------- email check */

  /** One email check: what it read, and each change it made, joined to its job or person. */
  emailDetail(runId: number): EmailRunDetail | null {
    const run = this.runs.get(runId)
    if (!run || run.flow !== 'email') return null
    const changes: EmailChange[] = []
    for (const row of this.activity.forEmailRun(runId)) {
      const email = row.emailId ? this.emails.get(row.emailId) : null
      if (!email) continue
      if (row.jobId) {
        const job = this.jobs.row(row.jobId)
        const status = job?.status ?? ''
        changes.push({
          id: row.id,
          at: row.at,
          kind: 'job',
          targetId: row.jobId,
          title: job?.company ?? 'A job no longer kept',
          subtitle: job?.role ?? '',
          from: row.kind === 'status' ? (row.fromState ?? status) : status,
          to: row.kind === 'status' ? (row.toState ?? status) : status,
          note: row.text,
          email: email.email,
          undone: row.undone,
        })
      } else if (row.personId) {
        const person = this.people.get(row.personId)
        changes.push({
          id: row.id,
          at: row.at,
          kind: 'person',
          targetId: row.personId,
          title: person?.name ?? 'Someone no longer kept',
          subtitle: row.companyId ? (this.companies.get(row.companyId)?.name ?? '') : '',
          from: row.fromState ?? person?.state ?? '',
          to: row.toState ?? person?.state ?? '',
          note: row.text,
          email: email.email,
          undone: row.undone,
        })
      }
    }
    return { run, ...this.emails.runCounts(runId), changes }
  }

  /** Puts a job or person back as it was before an email check changed it. */
  undoEmailChange(activityId: number): void {
    this.transaction(() => {
      const row = this.activity.get(activityId)
      if (!row || !row.emailId) throw new Error('That change is no longer recorded.')
      if (row.undone) return
      if (row.kind === 'status' && row.jobId && row.fromState) {
        this.jobs.setStatus(row.jobId, row.fromState, { text: `Undid the move to ${row.toState ?? 'a new status'} from an email` })
      } else if (row.kind === 'connected' && row.personId && row.fromState) {
        this.people.setState(row.personId, row.fromState as PersonState, { undo: true, companyId: row.companyId })
      }
      this.activity.markUndone(activityId)
    })
  }

  private emailSummary(): EmailSummary {
    const last = this.runs.last('email')
    return { lastRunId: last?.id ?? null, lastChecked: last?.started ?? null, moved: last ? this.activity.standingFromRun(last.id) : 0 }
  }

  /* ---------------------------------------------------------------- home */

  home(): HomeSummary {
    const counts = this.jobs.counts()
    const needsYou: NeedsYou[] = []

    for (const site of this.settings.sites()) {
      if (site.state === 'signed-out') {
        const name = site.site[0]!.toUpperCase() + site.site.slice(1)
        needsYou.push({ id: `site-${site.site}`, icon: 'sign-in', title: `${name} is signed out`, body: "In the app's Chrome", action: { label: 'Sign in', to: '#/settings/accounts' } })
      }
    }

    // Connections at a company you applied to who haven't been asked about its job yet.
    const active = this.jobs.withStatuses(ACTIVE_STATUSES)
    const companyIds = [...new Set(active.map(job => job.companyId))]
    const nobody: string[] = []
    let asks = 0
    for (const companyId of companyIds) {
      const job = this.appliedJob(companyId)
      if (!job) continue
      const here = this.people.atCompany(companyId).filter(person => person.current)
      if (!here.length) {
        if (job.status === 'applied') nobody.push(job.company)
        continue
      }
      const ready = here.filter(person => person.state === 'connected' && !this.outreach.find(job.id, person.id))
      if (ready.length && asks < 3) {
        asks++
        needsYou.push({
          id: `ask-${companyId}`,
          icon: 'users',
          title: `${ready.length} connected at ${job.company}, not asked yet`,
          body: `For ${job.role}`,
          action: { label: 'Ask', to: `#/company/${companyId}/ask` },
        })
      }
    }
    if (nobody.length) {
      const names = nobody.slice(0, 3).join(', ')
      needsYou.push({
        id: 'nobody',
        icon: 'users',
        title: `${nobody.length} applied ${nobody.length === 1 ? 'company' : 'companies'} with nobody to ask`,
        body: nobody.length > 3 ? `${names} and ${nobody.length - 3} more` : names,
        action: { label: 'Pick', to: '#/tracker/applied' },
      })
    }

    // Jobs the email check moved to interview this week.
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    for (const job of this.jobs.withStatuses(['interview']).slice(0, 20)) {
      const moved = this.activity.forJob(job.id).find(row => row.kind === 'status' && row.toState === 'interview' && !row.undone)
      if (moved?.emailId && moved.at >= weekAgo && needsYou.filter(need => need.icon === 'chat').length < 3) {
        needsYou.push({ id: `talk-${job.id}`, icon: 'chat', title: `${job.company} wants to talk`, body: `${job.role}: moved to interview by the email check`, action: { label: 'Open', to: `#/job/${job.id}` } })
      }
    }

    if (!this.settings.resume()) {
      needsYou.push({ id: 'resume', icon: 'warning', title: 'Add your resume', body: 'Applications and referral messages attach it', action: { label: 'Add', to: '#/settings/resume' } })
    }

    return {
      counts,
      companyCount: this.companies.count(),
      foundCount: counts['found'] ?? 0,
      needsYou,
      recentRuns: this.runs.recent(4),
      lastHunt: this.runs.last('hunt'),
      email: this.emailSummary(),
    }
  }

  close(): void {
    this.db.close()
  }
}
