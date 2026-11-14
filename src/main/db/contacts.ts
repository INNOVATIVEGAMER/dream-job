import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { CONTACT_STATES } from '../../shared/types'
import type { Contact, ContactState, ReadyCompany } from '../../shared/types'
import type { Companies } from './companies'
import { companyKey, now, today } from './database'

/** Accepted connections at one company that make a batch worth sending. */
export const BATCH_SIZE = 3

const COLUMNS = `id, name, role, company, profile_url AS profileUrl, sent, state,
  accepted_at AS acceptedAt, messaged_at AS messagedAt, referred_at AS referredAt, company_id AS companyId`

export const isContactState = (value: string): value is ContactState =>
  (CONTACT_STATES as readonly string[]).includes(value)

/** LinkedIn profile links reduced to one form, so the same person is never added twice. */
export function profileKey(url: string): string {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/^\/in\/([^/]+)/)
    if (match?.[1]) return `https://www.linkedin.com/in/${decodeURIComponent(match[1]).toLowerCase()}/`
    return `${parsed.origin}${parsed.pathname}`.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

export type NewContact = { name: string; role: string; company: string; profileUrl: string }

/** The people at the user's companies: a request sent, or connected. */
export class Contacts {
  constructor(
    private readonly db: DatabaseSync,
    private readonly companies: Companies,
  ) {}

  /** Records a sent request. A person already recorded is left as they are. */
  addPending(contact: NewContact, runId: number | null): { id: number; isNew: boolean } {
    return this.add(contact, 'pending', runId)
  }

  /**
   * Records someone already connected with the user. Someone recorded with a
   * request out becomes connected that day; someone new was connected before
   * the app knew them, so they carry no request date and no accepted date.
   */
  addAccepted(contact: NewContact, runId: number | null): { id: number; isNew: boolean } {
    const added = this.add(contact, 'accepted', runId)
    if (!added.isNew) this.setState(added.id, 'accepted')
    return added
  }

  private add(contact: NewContact, state: ContactState, runId: number | null): { id: number; isNew: boolean } {
    const url = profileKey(contact.profileUrl)
    const existing = this.db.prepare('SELECT id FROM contacts WHERE profile_url = ?').get(url) as { id: number } | undefined
    if (existing) return { id: Number(existing.id), isNew: false }
    const result = this.db
      .prepare('INSERT INTO contacts (name, role, company, profile_url, sent, state, run_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(contact.name.trim(), contact.role.trim(), contact.company.trim(), url, state === 'pending' ? today() : '', state, runId)
    const id = Number(result.lastInsertRowid)
    this.companies.attach('contacts', id, contact.company)
    return { id, isNew: true }
  }

  get(id: number): Contact | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE id = ?`).get(id)
    return row ? ({ ...row } as Contact) : null
  }

  byProfile(url: string): Contact | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE profile_url = ?`).get(profileKey(url))
    return row ? ({ ...row } as Contact) : null
  }

  isKnown(url: string): boolean {
    return this.byProfile(url) !== null
  }

  /** Moves a contact forward; never backward, so a late acceptance never undoes a message. */
  setState(id: number, state: ContactState): void {
    const contact = this.get(id)
    if (!contact) throw new Error(`no contact with id ${id}`)
    if (CONTACT_STATES.indexOf(state) <= CONTACT_STATES.indexOf(contact.state)) return
    const column = { pending: null, accepted: 'accepted_at' }[state]
    this.db.prepare(`UPDATE contacts SET state = ?${column ? `, ${column} = ?` : ''} WHERE id = ?`).run(
      ...([state, ...(column ? [today()] : []), id] as SQLInputValue[]),
    )
  }

  /** Records that the referral message went to them: it goes to each person once. */
  markMessaged(id: number): void {
    this.db.prepare('UPDATE contacts SET messaged_at = ? WHERE id = ?').run(today(), id)
  }

  counts(): Record<ContactState, number> {
    const counts: Record<ContactState, number> = { pending: 0, accepted: 0 }
    for (const row of this.db.prepare('SELECT state, COUNT(*) AS n FROM contacts GROUP BY state').all()) {
      const { state, n } = row as { state: string; n: number }
      if (isContactState(state)) counts[state] = Number(n)
    }
    return counts
  }

  /** Everyone at one company, connected first, then newest. */
  atCompanyId(companyId: number): Contact[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM contacts WHERE company_id = ? ORDER BY CASE state WHEN 'accepted' THEN 0 ELSE 1 END, sent DESC, id DESC`)
      .all(companyId)
      .map(row => ({ ...row }) as Contact)
  }

  /** Connections at one company the referral message has not gone to yet. */
  toMessage(company: string): Contact[] {
    return this.atCompany(company, 'accepted').filter(contact => !contact.messagedAt)
  }

  /** People at one company in one state, oldest request first. */
  atCompany(company: string, state: ContactState): Contact[] {
    const key = companyKey(company)
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM contacts WHERE state = ? ORDER BY sent ASC, id ASC`)
      .all(state)
      .map(row => ({ ...row }) as Contact)
      .filter(contact => companyKey(contact.company) === key)
  }

  /** Puts a contact back to an earlier state, clearing the dates of the states after it: for undoing a change. */
  revertState(id: number, state: ContactState): void {
    const contact = this.get(id)
    if (!contact) throw new Error(`no contact with id ${id}`)
    this.db.prepare(`UPDATE contacts SET state = ?${state === 'pending' ? ', accepted_at = NULL' : ''} WHERE id = ?`).run(state, id)
  }

  /** Contacts whose name matches, for the email check: an exact name first, else every name that contains it. */
  findByName(name: string): Contact[] {
    const wanted = name.trim().toLowerCase()
    if (!wanted) return []
    const all = this.db.prepare(`SELECT ${COLUMNS} FROM contacts`).all().map(row => ({ ...row }) as Contact)
    const exact = all.filter(contact => contact.name.trim().toLowerCase() === wanted)
    return exact.length ? exact : all.filter(contact => contact.name.toLowerCase().includes(wanted))
  }

  /** Everyone still pending: the referral run checks these for acceptance. */
  pending(): Contact[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM contacts WHERE state = 'pending' ORDER BY sent ASC, id ASC`)
      .all()
      .map(row => ({ ...row }) as Contact)
  }

  /** Companies with connections the referral message has not gone to yet. */
  readyCompanies(): Omit<ReadyCompany, 'opportunityId' | 'role' | 'appliedOn'>[] {
    const byCompany = new Map<string, { company: string; accepted: number; pending: number }>()
    for (const row of this.db.prepare('SELECT company, state, COUNT(*) AS n FROM contacts WHERE messaged_at IS NULL GROUP BY company, state').all()) {
      const { company, state, n } = row as { company: string; state: string; n: number }
      const key = companyKey(company)
      const entry = byCompany.get(key) ?? { company, accepted: 0, pending: 0 }
      if (state === 'accepted') entry.accepted += Number(n)
      if (state === 'pending') entry.pending += Number(n)
      byCompany.set(key, entry)
    }
    return [...byCompany.values()]
      .filter(entry => entry.accepted > 0)
      .map(entry => ({ ...entry, isReady: entry.accepted >= BATCH_SIZE || entry.pending === 0 }))
      .sort((a, b) => Number(b.isReady) - Number(a.isReady) || b.accepted - a.accepted)
  }

  lastChecked(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'contacts.checked'").get() as { value: string } | undefined
    return row ? (JSON.parse(row.value) as string) : null
  }

  markChecked(): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('contacts.checked', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(now()))
  }
}
