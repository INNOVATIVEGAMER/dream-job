import type { DatabaseSync } from 'node:sqlite'

import { PERSON_STATES } from '../../shared/types'
import type { PeopleCount, Person, PersonState, Position } from '../../shared/types'
import type { ActivityLog } from './activity'
import type { Companies } from './companies'
import { today } from './database'

const COLUMNS = 'p.id, p.name, p.headline, p.profile_url AS profileUrl, p.state'

export const isPersonState = (value: string): value is PersonState => (PERSON_STATES as readonly string[]).includes(value)

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

/** Someone a run met at a company on LinkedIn. */
export type NewPerson = { name: string; headline: string; profileUrl: string; companyId: number }

/** A person with whether they work at a given company now. */
export type PersonAt = Person & { current: boolean }

/**
 * People: everyone you sent a request to or are connected with, each
 * recorded once by their LinkedIn profile. Their connection follows them;
 * where they work is in positions, one per person and company, so a move
 * adds a position and leaving closes one, and nothing else is rewritten.
 */
export class People {
  constructor(
    private readonly db: DatabaseSync,
    private readonly companies: Companies,
    private readonly activity: ActivityLog,
  ) {}

  get(id: number): Person | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM people p WHERE p.id = ?`).get(id)
    return row ? ({ ...row } as Person) : null
  }

  byProfile(url: string): Person | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM people p WHERE p.profile_url = ?`).get(profileKey(url))
    return row ? ({ ...row } as Person) : null
  }

  isKnown(url: string): boolean {
    return this.byProfile(url) !== null
  }

  private companyName(companyId: number): string {
    return this.companies.get(companyId)?.name ?? 'a company'
  }

  /**
   * Records someone a request went to, with a current position at the company.
   * Someone already recorded is left as they are.
   */
  addRequested(person: NewPerson, runId: number | null): { id: number; isNew: boolean } {
    const known = this.byProfile(person.profileUrl)
    if (known) return { id: known.id, isNew: false }
    const id = this.insert(person, 'requested')
    this.activity.add({ kind: 'request-sent', personId: id, companyId: person.companyId, toState: 'requested', text: `Request sent to ${person.name.trim()}`, runId })
    return { id, isNew: true }
  }

  /**
   * Records someone already connected with you, with a current position at the
   * company. Someone recorded with a request out becomes connected; someone new
   * was connected before the app knew them.
   */
  addConnected(person: NewPerson, runId: number | null): { id: number; isNew: boolean } {
    const known = this.byProfile(person.profileUrl)
    if (known) {
      this.setState(known.id, 'connected', { runId, companyId: person.companyId })
      return { id: known.id, isNew: false }
    }
    const id = this.insert(person, 'connected')
    this.activity.add({ kind: 'connected', personId: id, companyId: person.companyId, toState: 'connected', text: `${person.name.trim()}, already a connection, added`, runId })
    return { id, isNew: true }
  }

  private insert(person: NewPerson, state: PersonState): number {
    const result = this.db
      .prepare('INSERT INTO people (name, headline, profile_url, state, added) VALUES (?, ?, ?, ?, ?)')
      .run(person.name.trim(), person.headline.trim(), profileKey(person.profileUrl), state, today())
    const id = Number(result.lastInsertRowid)
    this.db.prepare('INSERT INTO positions (person_id, company_id, current) VALUES (?, ?, 1)').run(id, person.companyId)
    return id
  }

  /**
   * Moves the connection forward (a request accepted), or back when undoing;
   * returns the Activity row's id, or null when nothing changed.
   */
  setState(id: number, state: PersonState, cause: { runId?: number | null; emailId?: number | null; companyId?: number | null; undo?: boolean } = {}): number | null {
    const person = this.get(id)
    if (!person) throw new Error(`no person with id ${id}`)
    if (person.state === state) return null
    if (!cause.undo && state === 'requested') return null
    this.db.prepare('UPDATE people SET state = ? WHERE id = ?').run(state, id)
    const companyId = cause.companyId ?? this.currentCompanies(id)[0] ?? null
    return this.activity.add({
      kind: 'connected',
      personId: id,
      companyId,
      fromState: person.state,
      toState: state,
      text: state === 'connected' ? `${person.name} connected` : `${person.name} back to request sent`,
      runId: cause.runId ?? null,
      emailId: cause.emailId ?? null,
    })
  }

  /** Keeps the headline LinkedIn shows now. */
  setHeadline(id: number, headline: string): void {
    if (headline.trim()) this.db.prepare('UPDATE people SET headline = ? WHERE id = ?').run(headline.trim(), id)
  }

  positions(personId: number): Position[] {
    return this.db
      .prepare('SELECT person_id AS personId, company_id AS companyId, current FROM positions WHERE person_id = ?')
      .all(personId)
      .map(row => {
        const position = row as { personId: number; companyId: number; current: number }
        return { ...position, current: Boolean(position.current) }
      })
  }

  currentCompanies(personId: number): number[] {
    return this.positions(personId).filter(position => position.current).map(position => position.companyId)
  }

  /** Records that someone works at a company now: a new position, or one they had reopened. */
  join(personId: number, companyId: number, runId: number | null): boolean {
    const had = this.positions(personId).find(position => position.companyId === companyId)
    if (had?.current) return false
    if (had) this.db.prepare('UPDATE positions SET current = 1 WHERE person_id = ? AND company_id = ?').run(personId, companyId)
    else this.db.prepare('INSERT INTO positions (person_id, company_id, current) VALUES (?, ?, 1)').run(personId, companyId)
    const person = this.get(personId)
    this.activity.add({ kind: 'joined', personId, companyId, toState: 'current', text: `${person?.name ?? 'Someone'} joined ${this.companyName(companyId)}`, runId })
    return true
  }

  /** Records that someone left a company: only on proof from their profile. Their history there stays. */
  leave(personId: number, companyId: number, runId: number | null, now?: string): boolean {
    const had = this.positions(personId).find(position => position.companyId === companyId)
    if (!had?.current) return false
    this.db.prepare('UPDATE positions SET current = 0 WHERE person_id = ? AND company_id = ?').run(personId, companyId)
    const person = this.get(personId)
    const where = now ? `, now at ${now}` : ''
    this.activity.add({ kind: 'left', personId, companyId, fromState: 'current', toState: 'left', text: `${person?.name ?? 'Someone'} left ${this.companyName(companyId)}${where}`, runId })
    return true
  }

  /** Everyone who works or worked at a company: current first, connected before requested. */
  atCompany(companyId: number): PersonAt[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS}, ps.current FROM people p JOIN positions ps ON ps.person_id = p.id WHERE ps.company_id = ?
         ORDER BY ps.current DESC, CASE p.state WHEN 'connected' THEN 0 ELSE 1 END, p.name COLLATE NOCASE`,
      )
      .all(companyId)
      .map(row => {
        const person = row as Person & { current: number }
        return { ...person, current: Boolean(person.current) }
      })
  }

  /** Who you know at each company now: connections and requests out, by current position. */
  counts(companyIds: number[]): Map<number, PeopleCount> {
    const out = new Map<number, PeopleCount>()
    if (!companyIds.length) return out
    for (const row of this.db
      .prepare(
        `SELECT ps.company_id AS companyId, p.state, COUNT(*) AS n FROM positions ps JOIN people p ON p.id = ps.person_id
         WHERE ps.current = 1 AND ps.company_id IN (${companyIds.map(() => '?').join(', ')}) GROUP BY ps.company_id, p.state`,
      )
      .all(...companyIds)) {
      const { companyId, state, n } = row as { companyId: number; state: string; n: number }
      const counts = out.get(companyId) ?? { connected: 0, requested: 0 }
      if (state === 'connected') counts.connected = Number(n)
      if (state === 'requested') counts.requested = Number(n)
      out.set(companyId, counts)
    }
    return out
  }

  /** Everyone with a request still out, with when it went: the accepted check reads back to the oldest. */
  requested(): (Person & { requested: string | null })[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS}, (SELECT MIN(a.at) FROM activity a WHERE a.person_id = p.id AND a.kind = 'request-sent') AS requested
         FROM people p WHERE p.state = 'requested' ORDER BY requested ASC, p.id ASC`,
      )
      .all()
      .map(row => ({ ...(row as Person & { requested: string | null }) }))
  }

  /** People whose name matches, for the email check: an exact name first, else every name that contains it. */
  findByName(name: string): Person[] {
    const wanted = name.trim().toLowerCase()
    if (!wanted) return []
    const all = this.db.prepare(`SELECT ${COLUMNS} FROM people p`).all().map(row => ({ ...row }) as Person)
    const exact = all.filter(person => person.name.trim().toLowerCase() === wanted)
    return exact.length ? exact : all.filter(person => person.name.toLowerCase().includes(wanted))
  }

  /** How many have a request out, and how many are connected. */
  stateCounts(): Record<PersonState, number> {
    const counts: Record<PersonState, number> = { requested: 0, connected: 0 }
    for (const row of this.db.prepare('SELECT state, COUNT(*) AS n FROM people GROUP BY state').all()) {
      const { state, n } = row as { state: string; n: number }
      if (isPersonState(state)) counts[state] = Number(n)
    }
    return counts
  }

  lastChecked(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'people.checked'").get() as { value: string } | undefined
    return row ? (JSON.parse(row.value) as string) : null
  }

  markChecked(at: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('people.checked', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(at))
  }
}
