import type { DatabaseSync } from 'node:sqlite'

import type { AppliedCompany } from '../../shared/api'
import { CONTACT_STATES } from '../../shared/types'
import type { Contact, ContactCompanies, ContactCompany, ContactState, ContactView, DiscardReason, EmailChange, EmailRunDetail, EmailSummary, HomeSummary, NeedsYou, ReadyCompany, TrackerRow } from '../../shared/types'
import { Companies, NeverShow } from './companies'
import { Contacts } from './contacts'
import { companyKey, openDatabase } from './database'
import { Discarded } from './discarded'
import { EmailStore } from './email'
import { Opportunities } from './opportunities'
import { Runs } from './runs'
import { SettingsStore } from './settings'

/**
 * Everything the app keeps, in `data/job.db`: one database, one owner (the
 * main process), and one object per kind of record.
 */
export class Store {
  readonly companies: Companies
  readonly opportunities: Opportunities
  readonly discarded: Discarded
  readonly neverShow: NeverShow
  readonly contacts: Contacts
  readonly runs: Runs
  readonly settings: SettingsStore
  readonly email: EmailStore

  private constructor(private readonly db: DatabaseSync) {
    this.companies = new Companies(db)
    this.opportunities = new Opportunities(db, this.companies)
    this.discarded = new Discarded(db, this.companies)
    this.neverShow = new NeverShow(this.companies)
    this.contacts = new Contacts(db, this.companies)
    this.runs = new Runs(db)
    this.settings = new SettingsStore(db)
    this.email = new EmailStore(db, this.companies)
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

  /** Contacts, company first: each company with the job applied for and its people in the view. */
  contactCompanies(view: ContactView, search: string): ContactCompanies {
    const all = this.contacts.all()
    const ready = new Set(this.contacts.readyCompanies().filter(entry => entry.isReady).map(entry => companyKey(entry.company)))
    const byCompany = new Map<number, { name: string; people: Contact[] }>()
    for (const contact of all as (Contact & { companyId: number | null })[]) {
      if (!contact.companyId) continue
      const entry = byCompany.get(contact.companyId) ?? { name: contact.company, people: [] }
      entry.people.push(contact)
      byCompany.set(contact.companyId, entry)
    }
    const wanted = search.trim().toLowerCase()
    const counts = { ready: ready.size, pending: 0, accepted: 0, messaged: 0, referred: 0, all: all.length } as Record<ContactView, number>
    for (const contact of all) counts[contact.state]++

    const companies: ContactCompany[] = []
    for (const [id, entry] of byCompany) {
      const company = this.companies.get(id)
      const name = company?.name ?? entry.name
      const states = Object.fromEntries(CONTACT_STATES.map(state => [state, entry.people.filter(person => person.state === state).length])) as Record<ContactState, number>
      const isReady = ready.has(companyKey(name))
      if (view === 'ready' && !isReady) continue
      let people = view === 'all' || view === 'ready' ? entry.people : entry.people.filter(person => person.state === view)
      if (wanted && !name.toLowerCase().includes(wanted)) people = people.filter(person => person.name.toLowerCase().includes(wanted))
      if (!people.length) continue
      const row = this.appliedRow(name)
      companies.push({ id, name, jobId: row?.id ?? null, role: row?.role ?? null, counts: states, isReady, people })
    }
    companies.sort((a, b) => Number(b.isReady) - Number(a.isReady) || b.counts.accepted - a.counts.accepted || a.name.localeCompare(b.name))
    return { companies, counts, people: all.length, companyCount: byCompany.size }
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

  /** One email check: what it read, each change joined to its row or contact, and the jobs it kept for the user. */
  emailDetail(runId: number): EmailRunDetail | null {
    const run = this.runs.get(runId)
    if (!run || run.flow !== 'email') return null
    const changes: EmailChange[] = this.email.changes(runId).map(change => {
      if (change.kind === 'contact') {
        const contact = this.contacts.get(change.targetId)
        return { ...change, title: contact?.name ?? 'A contact no longer kept', subtitle: contact ? `Contact at ${contact.company}` : '' }
      }
      const row = this.opportunities.get(change.targetId)
      return { ...change, title: row?.company ?? 'A row no longer in the tracker', subtitle: row?.role ?? '' }
    })
    return { run, ...this.email.runCounts(runId), changes, waiting: this.email.waiting(runId) }
  }

  /** Puts a row or contact back as it was before an email check changed it. */
  undoEmailChange(id: number): void {
    this.transaction(() => {
      const change = this.email.change(id)
      if (!change) throw new Error('That change is no longer recorded.')
      if (change.undone) return
      if (change.kind === 'row') {
        const row = this.opportunities.get(change.targetId)
        if (!row) throw new Error('That row is no longer in the tracker.')
        this.opportunities.setStatus(row.id, change.from, null)
        this.opportunities.appendNote(row.id, `Undid the move to ${change.to} from the email "${change.email.subject}".`)
      } else {
        this.contacts.revertState(change.targetId, change.from as never)
      }
      this.email.markUndone(id)
    })
  }

  /** Adds a job found in email to the tracker as found, with the email it came from in its notes. */
  addEmailJob(id: number): number {
    return this.transaction(() => {
      const job = this.email.waitingById(id)
      if (!job) throw new Error('That email is no longer kept.')
      const rowId = this.opportunities.addManual({
        company: job.company,
        role: job.role,
        stage: 'scaleup',
        portal: 'email',
        link: '',
        mode: '',
        notes: `From email: "${job.email.subject}" from ${job.email.from}, ${job.email.date}. ${job.summary}\nEmail: ${job.email.link}\nStage is provisional until you know the company's size.`,
      })
      this.email.setWaiting(id, 'added', rowId)
      return rowId
    })
  }

  private emailSummary(): EmailSummary {
    const last = this.runs.last('email')
    return {
      lastRunId: last?.id ?? null,
      lastChecked: last?.started ?? null,
      moved: last ? this.email.standing(last.id) : 0,
      waiting: this.email.waiting().length,
    }
  }

  home(): HomeSummary {
    const counts = this.opportunities.counts()
    const found = this.opportunities.found(1)
    const contactCounts = this.contacts.counts()
    const needsYou: NeedsYou[] = []

    for (const site of this.settings.sites()) {
      if (site.state === 'signed-out') {
        const name = site.site[0]!.toUpperCase() + site.site.slice(1)
        needsYou.push({ id: `site-${site.site}`, icon: 'sign-in', title: `${name} is signed out`, body: "In the app's Chrome", action: { label: 'Sign in', to: '#/settings/accounts' } })
      }
    }
    for (const company of this.readyCompanies().filter(entry => entry.isReady)) {
      needsYou.push({
        id: `ready-${company.company}`,
        icon: 'users',
        title: `${company.accepted} accepted at ${company.company}`,
        body: 'Ready for your referral message',
        action: { label: 'Message', to: `#/contacts/message/${encodeURIComponent(company.company)}` },
      })
    }
    const replied = this.opportunities.page({ status: 'replied', stage: 'all', portal: 'all', search: '', page: 0 }).rows
    for (const row of replied.slice(0, 3)) {
      needsYou.push({ id: `replied-${row.id}`, icon: 'chat', title: `${row.company} replied`, body: row.role, action: { label: 'Open', to: `#/opportunity/${row.id}` } })
    }
    const email = this.emailSummary()
    if (email.waiting > 0 && email.lastRunId) {
      needsYou.push({
        id: 'email-waiting',
        icon: 'hand',
        title: `${email.waiting} ${email.waiting === 1 ? 'email' : 'emails'} about jobs you don't track`,
        body: 'From the email check',
        action: { label: 'Review', to: `#/email/${email.lastRunId}` },
      })
    }
    if (!this.settings.resume()) {
      needsYou.push({ id: 'resume', icon: 'warning', title: 'Add your resume', body: 'Applications and referral messages attach it', action: { label: 'Add', to: '#/settings/resume' } })
    }

    return {
      counts,
      companyCount: this.companies.count(),
      nextFound: found[0] ?? null,
      foundCount: counts['found'] ?? 0,
      contactCounts,
      pendingCompanies: this.contacts.companyCount(),
      needsYou,
      recentRuns: this.runs.recent(4),
      lastHunt: this.runs.last('hunt'),
      email,
    }
  }

  close(): void {
    this.db.close()
  }
}
