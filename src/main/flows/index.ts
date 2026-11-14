import type { ConnectOptions, HuntOptions, ReferralOptions } from '../../shared/api'
import { CHECK_STATUSES, HUNT_PORTALS } from '../../shared/types'
import type { Store } from '../db/store'
import type { Company, Job } from '../../shared/types'
import { onePlan } from '../runs/engine'
import type { RunEngine } from '../runs/engine'
import { applyPlan } from './apply'
import { emailSpec } from './email'
import { huntPlan, plannedSearches } from './hunt'
import { checkPostingsPlan, isCheckable } from './postings'
import { checkSpec, connectPlan, peoplePlan, referralPlan } from './referral'

/**
 * Starts the flows. Each returns the new run's id at once; the run carries on
 * in the engine and shows on the run screen.
 */
export class Flows {
  constructor(
    private readonly engine: RunEngine,
    private readonly store: Store,
  ) {}

  async hunt(options: HuntOptions): Promise<number> {
    const settings = this.store.settings.portals()
    const portals = options.portals.filter(portal => HUNT_PORTALS.includes(portal) && settings[portal].enabled)
    if (portals.length === 0) throw new Error('Pick at least one portal that is turned on in Settings, Portals.')
    const prefs = this.store.settings.preferences()
    if (prefs.targetRoles.length === 0) throw new Error('Add the roles you want in Settings, Preferences first.')
    if (portals.includes('linkedin') && plannedSearches(prefs).length === 0) throw new Error('Turn on at least one work mode in Settings, Preferences.')
    return this.engine.start(huntPlan(this.store, portals, options.window))
  }

  /** Applies to found jobs: one session per job, 5 at a time. Jobs that can't be applied to are left out; with none left, it says why. */
  async apply(jobIds: number[]): Promise<number> {
    if (!this.store.settings.profile().name.trim()) throw new Error('Fill in your profile in Settings first.')
    const rows: Job[] = []
    let firstProblem: string | null = null
    for (const id of new Set(jobIds)) {
      const row = this.store.jobs.get(id)
      const problem = !row
        ? 'That job is no longer in the tracker.'
        : row.status !== 'found'
          ? `${row.company} is at ${row.status}, not found: apply works on found jobs.`
          : !row.link && !row.portalLink
            ? `${row.company} has no link to the posting. Add one on the job, then apply.`
            : null
      if (problem) firstProblem ??= problem
      else rows.push(row!)
    }
    if (rows.length === 0) throw new Error(firstProblem ?? 'Pick at least one found job.')
    return this.engine.start(applyPlan(this.store, rows))
  }

  /**
   * Checks found and applied jobs against the page their application goes to:
   * each keeps the company's apply page as its link, closed found jobs are
   * marked dead, and closed applied ones get a note. With no ids, all of them.
   */
  async checkPostings(jobIds: number[]): Promise<number> {
    const ids = jobIds.length ? [...new Set(jobIds)] : this.store.jobs.withStatuses(CHECK_STATUSES).map(row => row.id)
    const rows = ids.map(id => this.store.jobs.get(id)).filter((row): row is Job => !!row && isCheckable(row))
    if (rows.length === 0) throw new Error('Pick found or applied jobs with a posting to check.')
    return this.engine.start(checkPostingsPlan(this.store, rows))
  }

  async connect(options: ConnectOptions): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    const companies = [...new Set(options.companyIds)]
      .map(id => this.store.companies.get(id))
      .filter((company): company is Company => !!company && !!this.store.connectJob(company.id))
    if (companies.length === 0) throw new Error('Pick a company with a found or applied job: requests point at one.')
    return this.engine.start(connectPlan(this.store, companies, options.perCompany))
  }

  /** Reads the user's LinkedIn connections at each company, so its people and their statuses are current. */
  async refreshPeople(companyIds: number[]): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    const companies = [...new Set(companyIds)].map(id => this.store.companies.get(id)).filter(company => company !== null)
    if (companies.length === 0) throw new Error('Those companies are no longer in the tracker.')
    return this.engine.start(peoplePlan(this.store, companies))
  }

  /** The referral message about one job, to the people picked: each must be connected, work at its company now, and not have been asked about it. */
  async referral(options: ReferralOptions): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    const referral = this.store.settings.referral()
    if (!referral.template.trim()) throw new Error('Save your referral message in Settings first.')
    if (options.resume && !this.store.settings.resume()) throw new Error('The message attaches your resume: add it in Settings first, or send it without.')
    const job = this.store.jobs.row(options.jobId)
    if (!job) throw new Error('That job is no longer in the tracker.')
    const personIds = [...new Set(options.personIds)].filter(id => {
      const person = this.store.people.get(id)
      return person?.state === 'connected' && this.store.people.currentCompanies(id).includes(job.companyId) && !this.store.outreach.find(job.id, id)
    })
    if (personIds.length === 0) throw new Error(`Pick someone connected at ${job.company} who hasn't been asked about this job.`)
    return this.engine.start(referralPlan(this.store, { jobId: job.id, personIds, resume: options.resume }))
  }

  /** Reads the newest emails in Gmail and moves the tracker on; `count` overrides the setting for one check. */
  async email(options: { count?: number } = {}): Promise<number> {
    const settings = this.store.settings.email()
    if (!settings.enabled) throw new Error('Gmail is turned off in Settings, Portals.')
    const count = options.count && [25, 50, 100].includes(options.count) ? options.count : settings.count
    return this.engine.start(onePlan(emailSpec(this.store, count)))
  }

  /** The check when the app opens, when the user turned it on: at most once a day, and only when nothing else runs. */
  async emailOnOpen(): Promise<void> {
    const settings = this.store.settings.email()
    if (!settings.enabled || !settings.checkOnOpen || !this.store.settings.isSetUp() || this.engine.isBusy()) return
    const last = this.store.runs.last('email')
    if (last && Date.now() - new Date(last.started).getTime() < 20 * 60 * 60 * 1000) return
    await this.email().catch(() => undefined)
  }

  async checkAccepted(): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    if (this.store.people.stateCounts().requested === 0) throw new Error('Nobody has a request out: send connection requests first.')
    return this.engine.start(onePlan(checkSpec(this.store)))
  }
}
