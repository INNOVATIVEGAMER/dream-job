import type { ConnectOptions, HuntOptions, ReferralOptions } from '../../shared/api'
import { HUNT_PORTALS } from '../../shared/types'
import type { Store } from '../db/store'
import type { Opportunity } from '../../shared/types'
import { onePlan } from '../runs/engine'
import type { RunEngine } from '../runs/engine'
import { applyPlan } from './apply'
import { emailSpec } from './email'
import { huntPlan, plannedSearches } from './hunt'
import { checkPostingsPlan, isCheckable } from './postings'
import { checkSpec, connectPlan, referralPlan, referralReach } from './referral'

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

  /** Applies to found rows: one session per row, 5 at a time. Rows that can't be applied to are left out; with none left, it says why. */
  async apply(opportunityIds: number[]): Promise<number> {
    if (!this.store.settings.profile().name.trim()) throw new Error('Fill in your profile in Settings first.')
    const rows: Opportunity[] = []
    let firstProblem: string | null = null
    for (const id of new Set(opportunityIds)) {
      const row = this.store.opportunities.get(id)
      const problem = !row
        ? 'That row is no longer in the tracker.'
        : row.status !== 'found'
          ? `${row.company} is at ${row.status}, not found: apply works found rows.`
          : !row.link && !(['linkedin', 'instahyre'].includes(row.portal.toLowerCase()) && row.jobId)
            ? `${row.company} has no link to the posting. Add one on the row, then apply.`
            : null
      if (problem) firstProblem ??= problem
      else rows.push(row!)
    }
    if (rows.length === 0) throw new Error(firstProblem ?? 'Pick at least one found row.')
    return this.engine.start(applyPlan(this.store, rows))
  }

  /**
   * Checks found jobs against the page their application goes to: closed ones
   * are marked dead, and each keeps the company's apply page as its link.
   * With no ids, every found job.
   */
  async checkPostings(opportunityIds: number[]): Promise<number> {
    const ids = opportunityIds.length ? [...new Set(opportunityIds)] : this.store.opportunities.found(1000).map(row => row.id)
    const rows = ids.map(id => this.store.opportunities.get(id)).filter((row): row is Opportunity => !!row && isCheckable(row))
    if (rows.length === 0) throw new Error('Pick found jobs with a posting to check.')
    return this.engine.start(checkPostingsPlan(this.store, rows))
  }

  async connect(options: ConnectOptions): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    const companies = options.companies.filter(company => this.store.appliedRow(company))
    if (companies.length === 0) throw new Error('Pick a company you have applied to: requests point at an application.')
    return this.engine.start(connectPlan(this.store, companies, options.perCompany))
  }

  async referral(options: ReferralOptions): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    const referral = this.store.settings.referral()
    if (!referral.template.trim()) throw new Error('Save your referral message in Settings first.')
    if (referral.attachResume && !this.store.settings.resume()) throw new Error('The message attaches your resume: add it in Settings first, or turn attaching off.')
    if (referralReach(this.store, options.companies) === 0) throw new Error('Nobody has accepted at those companies yet.')
    return this.engine.start(referralPlan(this.store, options.companies))
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
    if (this.store.contacts.counts().pending === 0) throw new Error('Nobody is pending: send connection requests first.')
    return this.engine.start(onePlan(checkSpec(this.store)))
  }
}
