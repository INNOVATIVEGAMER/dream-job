import type { ConnectOptions, HuntOptions, ReferralOptions } from '../../shared/api'
import { HUNT_PORTALS } from '../../shared/types'
import type { Store } from '../db/store'
import type { RunEngine } from '../runs/engine'
import { applySpec } from './apply'
import { huntSpec, plannedSearches } from './hunt'
import { checkSpec, connectSpec, referralReach, referralSpec } from './referral'

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
    return this.engine.start(huntSpec(this.store, portals, options.window))
  }

  async apply(opportunityId: number): Promise<number> {
    const row = this.store.opportunities.get(opportunityId)
    if (!row) throw new Error('That row is no longer in the tracker.')
    if (row.status !== 'found') throw new Error(`${row.company} is at ${row.status}, not found: apply works found rows.`)
    if (!row.link && !(['linkedin', 'instahyre'].includes(row.portal.toLowerCase()) && row.jobId)) {
      throw new Error('This row has no link to the posting. Add one on the row, then apply.')
    }
    if (!this.store.settings.profile().name.trim()) throw new Error('Fill in your profile in Settings first.')
    return this.engine.start(applySpec(this.store, row))
  }

  async connect(options: ConnectOptions): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    const companies = options.companies.filter(company => this.store.appliedRow(company))
    if (companies.length === 0) throw new Error('Pick a company you have applied to: requests point at an application.')
    return this.engine.start(connectSpec(this.store, companies, options.perCompany))
  }

  async referral(options: ReferralOptions): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    const referral = this.store.settings.referral()
    if (!referral.template.trim()) throw new Error('Save your referral message in Settings first.')
    if (referral.attachResume && !this.store.settings.resume()) throw new Error('The message attaches your resume: add it in Settings first, or turn attaching off.')
    if (referralReach(this.store, options.companies) === 0) throw new Error('Nobody has accepted at those companies yet.')
    return this.engine.start(referralSpec(this.store, options.companies))
  }

  async checkAccepted(): Promise<number> {
    if (!this.store.settings.portals().linkedin.enabled) throw new Error('LinkedIn is turned off in Settings, Portals.')
    if (this.store.contacts.counts().pending === 0) throw new Error('Nobody is pending: send connection requests first.')
    return this.engine.start(checkSpec(this.store))
  }
}
