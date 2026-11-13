import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { CONTACT_STATES } from '../../shared/types'
import type { Contact, ContactPage, ContactQuery, ContactState, ReadyCompany } from '../../shared/types'
import { companyKey, now, paging, today } from './database'

export const CONTACTS_PAGE_SIZE = 15

/** Accepted connections at one company that make a batch worth sending. */
export const BATCH_SIZE = 3

const COLUMNS = `id, name, role, company, profile_url AS profileUrl, sent, state,
  accepted_at AS acceptedAt, messaged_at AS messagedAt, referred_at AS referredAt`

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

/** Everyone a blank connection request went to, and where each one stands. */
export class Contacts {
  constructor(private readonly db: DatabaseSync) {}

  /** Records a sent request. A person already recorded is left as they are. */
  addPending(contact: NewContact, runId: number | null): { id: number; isNew: boolean } {
    const url = profileKey(contact.profileUrl)
    const existing = this.db.prepare('SELECT id FROM contacts WHERE profile_url = ?').get(url) as { id: number } | undefined
    if (existing) return { id: Number(existing.id), isNew: false }
    const result = this.db
      .prepare(`INSERT INTO contacts (name, role, company, profile_url, sent, state, run_id) VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .run(contact.name.trim(), contact.role.trim(), contact.company.trim(), url, today(), runId)
    return { id: Number(result.lastInsertRowid), isNew: true }
  }

  /** Records someone already connected with the user, ready for the referral message. */
  addAccepted(contact: NewContact, runId: number | null): { id: number; isNew: boolean } {
    const added = this.addPending(contact, runId)
    this.setState(added.id, 'accepted')
    return added
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
    const column = { pending: null, accepted: 'accepted_at', messaged: 'messaged_at', referred: 'referred_at' }[state]
    this.db.prepare(`UPDATE contacts SET state = ?${column ? `, ${column} = ?` : ''} WHERE id = ?`).run(
      ...([state, ...(column ? [today()] : []), id] as SQLInputValue[]),
    )
  }

  page(query: ContactQuery): ContactPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (isContactState(query.state)) {
      where.push('state = ?')
      params.push(query.state)
    }
    if (query.company && query.company !== 'all') {
      where.push('company = ?')
      params.push(query.company)
    }
    const search = query.search.trim().toLowerCase()
    if (search) {
      where.push('(lower(name) LIKE ? OR lower(company) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM contacts ${clause}`).get(...params) as { n: number }).n)
    const { at, pages } = paging(total, query.page, CONTACTS_PAGE_SIZE)
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM contacts ${clause}
         ORDER BY CASE state WHEN 'accepted' THEN 0 WHEN 'referred' THEN 1 WHEN 'messaged' THEN 2 ELSE 3 END, sent DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, CONTACTS_PAGE_SIZE, at * CONTACTS_PAGE_SIZE)
      .map(row => ({ ...row }) as Contact)
    const companies = this.db
      .prepare('SELECT DISTINCT company FROM contacts ORDER BY company COLLATE NOCASE')
      .all()
      .map(row => String((row as { company: string }).company))
    return { rows, total, counts: this.counts(), companies, page: at, pages, pageSize: CONTACTS_PAGE_SIZE }
  }

  counts(): Record<ContactState, number> {
    const counts: Record<ContactState, number> = { pending: 0, accepted: 0, messaged: 0, referred: 0 }
    for (const row of this.db.prepare('SELECT state, COUNT(*) AS n FROM contacts GROUP BY state').all()) {
      const { state, n } = row as { state: string; n: number }
      if (isContactState(state)) counts[state] = Number(n)
    }
    return counts
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
    const at = CONTACT_STATES.indexOf(state)
    const clear = (['accepted', 'messaged', 'referred'] as const).filter(later => CONTACT_STATES.indexOf(later) > at).map(later => `${later}_at = NULL`)
    this.db.prepare(`UPDATE contacts SET state = ?${clear.length ? `, ${clear.join(', ')}` : ''} WHERE id = ?`).run(state, id)
  }

  /** Contacts whose name matches, for the email check: an exact name first, else every name that contains it. */
  findByName(name: string): Contact[] {
    const wanted = name.trim().toLowerCase()
    if (!wanted) return []
    const all = this.db.prepare(`SELECT ${COLUMNS} FROM contacts`).all().map(row => ({ ...row }) as Contact)
    const exact = all.filter(contact => contact.name.trim().toLowerCase() === wanted)
    return exact.length ? exact : all.filter(contact => contact.name.toLowerCase().includes(wanted))
  }

  /** Records that the user thanked someone who referred them; the draft is theirs to send. */
  markThanked(id: number): void {
    this.db.prepare('UPDATE contacts SET thanked_at = ? WHERE id = ?').run(today(), id)
  }

  /** Everyone still pending: the referral run checks these for acceptance. */
  pending(): Contact[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM contacts WHERE state = 'pending' ORDER BY sent ASC, id ASC`)
      .all()
      .map(row => ({ ...row }) as Contact)
  }

  /** Companies with accepted connections not yet messaged. */
  readyCompanies(): Omit<ReadyCompany, 'opportunityId' | 'role' | 'appliedOn'>[] {
    const byCompany = new Map<string, { company: string; accepted: number; pending: number }>()
    for (const row of this.db.prepare('SELECT company, state, COUNT(*) AS n FROM contacts GROUP BY company, state').all()) {
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

  /** Companies with any request out, for the Home count. */
  companyCount(): number {
    return Number((this.db.prepare("SELECT COUNT(DISTINCT company) AS n FROM contacts WHERE state = 'pending'").get() as { n: number }).n)
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
