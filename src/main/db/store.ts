import type { DatabaseSync } from 'node:sqlite'

import type { AppliedCompany } from '../../shared/api'
import type { DiscardReason, HomeSummary, NeedsYou, ReadyCompany, TrackerRow } from '../../shared/types'
import { Contacts } from './contacts'
import { companyKey, openDatabase } from './database'
import { Discarded, NeverShow } from './discarded'
import { Opportunities } from './opportunities'
import { Runs } from './runs'
import { SettingsStore } from './settings'

/**
 * Everything the app keeps, in `data/job.db`: one database, one owner (the
 * main process), and one object per kind of record.
 */
export class Store {
  readonly opportunities: Opportunities
  readonly discarded: Discarded
  readonly neverShow: NeverShow
  readonly contacts: Contacts
  readonly runs: Runs
  readonly settings: SettingsStore

  private constructor(private readonly db: DatabaseSync) {
    this.opportunities = new Opportunities(db)
    this.discarded = new Discarded(db)
    this.neverShow = new NeverShow(db)
    this.contacts = new Contacts(db)
    this.runs = new Runs(db)
    this.settings = new SettingsStore(db)
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

  /**
   * The row a referral at this company points at: the newest one still in
   * play after applying. A rejected or dead row is no one's to refer.
   */
  appliedRow(company: string): TrackerRow | null {
    const active = new Set(['applied', 'outreach', 'replied', 'screen', 'onsite', 'offer'])
    return this.opportunities.forCompany(company).find(row => active.has(row.status)) ?? null
  }

  /** Companies ready for the referral message, each with the applied row it points at. */
  readyCompanies(): ReadyCompany[] {
    return this.contacts.readyCompanies().map(entry => {
      const row = this.appliedRow(entry.company)
      return { ...entry, opportunityId: row?.id ?? null, role: row?.role ?? null, appliedOn: row ? row.lastTouch : null }
    })
  }

  /** Companies the user applied to, newest first, with where their connection requests stand. */
  appliedCompanies(): AppliedCompany[] {
    const active = new Set(['applied', 'outreach', 'replied', 'screen', 'onsite', 'offer'])
    const byCompany = new Map<string, AppliedCompany>()
    for (const row of this.allRows()) {
      if (!active.has(row.status)) continue
      const key = companyKey(row.company)
      if (byCompany.has(key)) continue
      byCompany.set(key, { company: row.company, role: row.role, appliedOn: row.lastTouch, opportunityId: row.id, pending: 0, accepted: 0, total: 0 })
    }
    for (const entry of byCompany.values()) {
      const counts = { pending: 0, accepted: 0, total: 0 }
      for (const state of ['pending', 'accepted', 'messaged', 'referred'] as const) {
        const people = this.contacts.atCompany(entry.company, state).length
        counts.total += people
        if (state === 'pending') counts.pending = people
        if (state === 'accepted') counts.accepted = people
      }
      Object.assign(entry, counts)
    }
    return [...byCompany.values()]
  }

  private allRows(): TrackerRow[] {
    const rows: TrackerRow[] = []
    for (let page = 0; ; page++) {
      const result = this.opportunities.page({ status: 'all', stage: 'all', portal: 'all', search: '', page })
      rows.push(...result.rows)
      if (page >= result.pages - 1) break
    }
    return rows
  }

  /** Moves a discarded posting back into the tracker as found. */
  restoreDiscarded(id: number): number {
    return this.transaction(() => {
      const posting = this.discarded.get(id)
      if (!posting) throw new Error(`no discarded posting with id ${id}`)
      const rowId = this.opportunities.addManual({
        company: posting.company,
        role: posting.role,
        stage: 'scaleup',
        portal: posting.portal,
        link: posting.link ?? '',
        mode: '',
        notes: `Moved back from Discarded. It had been ruled out by: "${posting.line}"`,
      })
      this.discarded.remove(id)
      return rowId
    })
  }

  /** Moves a tracker row to Discarded, with the posting's words that ruled it out. */
  discardRow(id: number, line: string, reason: DiscardReason, runId: number | null): number {
    return this.transaction(() => {
      const row = this.opportunities.get(id)
      if (!row) throw new Error(`no opportunity with id ${id}`)
      const discardId = this.discarded.add({ company: row.company, role: row.role, portal: row.portal, jobId: row.jobId, link: row.link, line, reason }, runId)
      this.opportunities.remove(id)
      return discardId
    })
  }

  home(): HomeSummary {
    const counts = this.opportunities.counts()
    const found = this.opportunities.found(1)
    const contactCounts = this.contacts.counts()
    const needsYou: NeedsYou[] = []

    for (const site of this.settings.sites()) {
      if (site.state === 'signed-out') {
        const name = site.site[0]!.toUpperCase() + site.site.slice(1)
        needsYou.push({
          id: `site-${site.site}`,
          icon: 'sign-in',
          title: `${name} signed you out`,
          body: `Sign in once in Chrome. Runs on ${name} wait until you do.`,
          action: { label: 'Open to sign in', to: '#/settings/accounts' },
        })
      }
    }
    for (const company of this.readyCompanies().filter(entry => entry.isReady)) {
      needsYou.push({
        id: `ready-${company.company}`,
        icon: 'users',
        title: `${company.accepted} accepted at ${company.company}`,
        body: 'Ready for your referral message, word for word, with your resume.',
        action: { label: 'Send messages', to: '#/contacts' },
      })
    }
    const replied = this.opportunities.page({ status: 'replied', stage: 'all', portal: 'all', search: '', page: 0 }).rows
    for (const row of replied.slice(0, 3)) {
      needsYou.push({
        id: `replied-${row.id}`,
        icon: 'chat',
        title: `${row.company} replied`,
        body: row.nextAction || 'Your reply is yours to send.',
        action: { label: 'Open the row', to: `#/opportunity/${row.id}` },
      })
    }
    if (!this.settings.resume()) {
      needsYou.push({
        id: 'resume',
        icon: 'warning',
        title: 'Add your resume',
        body: 'Apply and the referral message attach it. Add the PDF in Settings.',
        action: { label: 'Open Settings', to: '#/settings/resume' },
      })
    }

    return {
      counts,
      nextFound: found[0] ?? null,
      foundCount: counts['found'] ?? 0,
      contactCounts,
      pendingCompanies: this.contacts.companyCount(),
      needsYou,
      recentRuns: this.runs.recent(4),
      lastHunt: this.runs.last('hunt'),
    }
  }

  close(): void {
    this.db.close()
  }
}
