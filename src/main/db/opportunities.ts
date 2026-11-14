import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { PORTALS, STAGES, STATUSES, WORK_MODES, workModeOf } from '../../shared/types'
import type {
  NewOpportunity,
  Opportunity,
  OpportunityEvent,
  TrackerPage,
  TrackerQuery,
  TrackerRow,
  WorkMode,
} from '../../shared/types'
import { linkKey } from '../../shared/links'
import type { Companies } from './companies'
import { companyKey, now, paging, today } from './database'

export const PAGE_SIZE = 15

const ROW = `id, company, role, stage, score, status, last_touch AS lastTouch,
  next_action AS nextAction, portal, job_id AS jobId, link, posting_state AS postingState, work_mode AS workMode, min_years AS minYears, portal_link AS portalLink, company_id AS companyId`

const FULL = `${ROW}, found, mode, applicants, referral, notes, pay, experience,
  apply_route AS applyRoute, score_reasons AS scoreReasons,
  posting_checked AS postingChecked, posting_note AS postingNote`

export const isStatus = (value: string): boolean => (STATUSES as readonly string[]).includes(value)

/** A posting the hunt adds as `found`. */
export type FoundPosting = {
  company: string
  role: string
  stage: string
  portal: string
  jobId: string
  /** Where the application goes: the company's own page when applying leaves the portal. */
  link: string
  /** The posting on the portal. */
  portalLink: string
  /** `unreadable` when the company's page could not be read, so the portal's facts stand. */
  postingState: 'open' | 'unreadable'
  postingNote: string | null
  mode: string
  workMode: WorkMode
  minYears: number | null
  applicants: string
  pay: string | null
  experience: string | null
  applyRoute: string | null
  score: number
  scoreReasons: string[]
  notes: string
}

function parseReasons(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** The opportunities: every posting from the hunt onward, the tracker's rows. */
export class Opportunities {
  constructor(
    private readonly db: DatabaseSync,
    private readonly companies: Companies,
  ) {}

  page(query: TrackerQuery): TrackerPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (isStatus(query.status)) {
      where.push('status = ?')
      params.push(query.status)
    }
    if ((STAGES as readonly string[]).includes(query.stage)) {
      where.push('stage = ?')
      params.push(query.stage)
    }
    if ((PORTALS as readonly string[]).includes(query.portal)) {
      where.push('lower(portal) = ?')
      params.push(query.portal)
    } else if (query.portal === 'other') {
      where.push(`lower(portal) NOT IN (${PORTALS.map(() => '?').join(', ')})`)
      params.push(...PORTALS)
    }
    const search = query.search.trim().toLowerCase()
    if (search) {
      where.push('(lower(company) LIKE ? OR lower(role) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM opportunities ${clause}`).get(...params) as { n: number }).n)
    const { at, pages } = paging(total, query.page, PAGE_SIZE)
    const rows = this.db
      .prepare(`SELECT ${ROW} FROM opportunities ${clause} ORDER BY last_touch DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, PAGE_SIZE, at * PAGE_SIZE)
      .map(row => ({ ...row }) as TrackerRow)
    const counts = this.counts()

    return { rows, total, all: Object.values(counts).reduce((sum, n) => sum + n, 0), counts, page: at, pages, pageSize: PAGE_SIZE }
  }

  counts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS n FROM opportunities GROUP BY status').all()) {
      const { status, n } = row as { status: string; n: number }
      counts[status] = Number(n)
    }
    return counts
  }

  get(id: number): Opportunity | null {
    const row = this.db.prepare(`SELECT ${FULL} FROM opportunities WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return { ...(row as unknown as Opportunity), scoreReasons: parseReasons(row['scoreReasons']) }
  }

  /** The jobs one run added, best score first: what a hunt found. */
  byRun(runId: number): TrackerRow[] {
    return this.db
      .prepare(`SELECT ${ROW} FROM opportunities WHERE run_id = ? ORDER BY score DESC, id ASC`)
      .all(runId)
      .map(row => ({ ...row }) as TrackerRow)
  }

  /** Jobs at any of `statuses`, found first, then best score. */
  withStatuses(statuses: readonly string[]): TrackerRow[] {
    if (statuses.length === 0) return []
    return this.db
      .prepare(`SELECT ${ROW} FROM opportunities WHERE status IN (${statuses.map(() => '?').join(', ')}) ORDER BY status = 'found' DESC, score DESC, id ASC`)
      .all(...statuses)
      .map(row => ({ ...row }) as TrackerRow)
  }

  /**
   * A row already tracked for this posting: the same portal and job id, or
   * the same company and role. The hunt skips these.
   */
  findExisting(portal: string, jobId: string, company: string, role: string, link?: string | null): TrackerRow | null {
    if (link) {
      // The same apply page, whichever portal showed it.
      const key = linkKey(link)
      for (const row of this.db.prepare(`SELECT ${ROW} FROM opportunities WHERE link IS NOT NULL`).all()) {
        const candidate = row as TrackerRow
        if (candidate.link && linkKey(candidate.link) === key) return { ...candidate }
      }
    }
    if (jobId) {
      const byJob = this.db
        .prepare(`SELECT ${ROW} FROM opportunities WHERE lower(portal) = lower(?) AND job_id = ? LIMIT 1`)
        .get(portal, jobId) as TrackerRow | undefined
      if (byJob) return { ...byJob }
    }
    const key = companyKey(company)
    const wantedRole = role.trim().toLowerCase()
    for (const row of this.db.prepare(`SELECT ${ROW} FROM opportunities WHERE lower(role) = ?`).all(wantedRole)) {
      const candidate = row as TrackerRow
      if (companyKey(candidate.company) === key) return { ...candidate }
    }
    return null
  }

  /** Rows for one company, newest first: for the referral track and the one-route rule. */
  forCompany(company: string): TrackerRow[] {
    const key = companyKey(company)
    return this.db
      .prepare(`SELECT ${ROW} FROM opportunities ORDER BY last_touch DESC, id DESC`)
      .all()
      .map(row => ({ ...row }) as TrackerRow)
      .filter(row => companyKey(row.company) === key)
  }

  addFound(posting: FoundPosting, runId: number | null): number {
    const day = today()
    const result = this.db
      .prepare(
        `INSERT INTO opportunities (found, company, stage, role, portal, job_id, mode, work_mode, min_years, applicants, referral, score,
          status, last_touch, next_action, notes, updated_at, link, portal_link, posting_state, posting_note, posting_checked, pay,
          experience, apply_route, score_reasons, run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'found', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        day,
        posting.company,
        posting.stage,
        posting.role,
        posting.portal,
        posting.jobId,
        posting.mode,
        posting.workMode,
        posting.minYears,
        posting.applicants,
        'Connection requests are the next step',
        posting.score,
        day,
        'Apply',
        posting.notes,
        day,
        posting.link,
        posting.portalLink,
        posting.postingState,
        posting.postingNote,
        now(),
        posting.pay,
        posting.experience,
        posting.applyRoute,
        JSON.stringify(posting.scoreReasons),
        runId,
      )
    const id = Number(result.lastInsertRowid)
    this.companies.attach('opportunities', id, posting.company, posting.stage)
    this.addEvent(id, `Found by run ${runId ?? '?'} on ${posting.portal}`, runId)
    return id
  }

  /** A row the user adds by hand, at `applied` if they already applied, else `found`. */
  addManual(input: NewOpportunity): number {
    const day = today()
    const result = this.db
      .prepare(
        `INSERT INTO opportunities (found, company, stage, role, portal, job_id, mode, work_mode, applicants, referral, score,
          status, last_touch, next_action, notes, updated_at, link)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, '', 'Connection requests are the next step', NULL, 'found', ?, '', ?, ?, ?)`,
      )
      .run(
        day,
        input.company.trim(),
        input.stage,
        input.role.trim(),
        input.portal.trim() || 'direct',
        input.mode.trim(),
        input.workMode ?? workModeOf(input.mode),
        day,
        input.notes.trim(),
        day,
        input.link.trim() || null,
      )
    const id = Number(result.lastInsertRowid)
    this.companies.attach('opportunities', id, input.company, input.stage)
    this.addEvent(id, 'Added by you', null)
    return id
  }

  /** Saves a status, dating the change. Refuses a status outside the known set or an unknown row. */
  setStatus(id: number, status: string, runId: number | null = null): void {
    if (!isStatus(status)) throw new Error(`${status} is not a tracker status`)
    const day = today()
    const result = this.db
      .prepare('UPDATE opportunities SET status = ?, updated_at = ?, last_touch = ? WHERE id = ?')
      .run(status, day, day, id)
    if (Number(result.changes) !== 1) throw new Error(`no opportunity with id ${id}`)
    this.addEvent(id, `Status set to ${status}`, runId)
  }

  setNotes(id: number, notes: string): void {
    const result = this.db.prepare('UPDATE opportunities SET notes = ?, updated_at = ? WHERE id = ?').run(notes, today(), id)
    if (Number(result.changes) !== 1) throw new Error(`no opportunity with id ${id}`)
  }

  /** Adds a dated paragraph to the notes: what a run recorded. */
  appendNote(id: number, text: string): void {
    const row = this.get(id)
    if (!row) throw new Error(`no opportunity with id ${id}`)
    const note = `${today()}: ${text.trim()}`
    this.setNotes(id, row.notes.trim() ? `${row.notes.trim()}\n\n${note}` : note)
  }

  /** Saves the links and route a run read off the pages; a value left out keeps what is there. */
  setLinks(id: number, links: { link?: string | null; portalLink?: string | null; applyRoute?: string | null }): void {
    const current = this.get(id)
    if (!current) throw new Error(`no opportunity with id ${id}`)
    this.db
      .prepare('UPDATE opportunities SET link = ?, portal_link = ?, apply_route = ?, updated_at = ? WHERE id = ?')
      .run(links.link ?? current.link, links.portalLink ?? current.portalLink, links.applyRoute ?? current.applyRoute, today(), id)
  }

  /** The links the user pasted on the job page: the posting, and where the application goes. Empty clears one. */
  setLinksByUser(id: number, portalLink: string | null, link: string | null): void {
    const result = this.db.prepare('UPDATE opportunities SET portal_link = ?, link = ?, updated_at = ? WHERE id = ?').run(portalLink, link, today(), id)
    if (Number(result.changes) !== 1) throw new Error(`no opportunity with id ${id}`)
    this.addEvent(id, 'Links set by you', null)
  }

  /** The work mode and place in words, such as "Hybrid, Bengaluru". */
  setMode(id: number, mode: string): void {
    this.db.prepare('UPDATE opportunities SET mode = ?, updated_at = ? WHERE id = ?').run(mode, today(), id)
  }

  /** The fewest years of experience the job asks for, with the posting's words that state it. */
  setMinYears(id: number, minYears: number, quote: string): void {
    this.db.prepare('UPDATE opportunities SET min_years = ?, experience = ?, updated_at = ? WHERE id = ?').run(minYears, quote, today(), id)
  }

  setWorkMode(id: number, workMode: WorkMode): void {
    if (!(WORK_MODES as readonly string[]).includes(workMode)) throw new Error(`${workMode} is not a work mode`)
    const result = this.db.prepare('UPDATE opportunities SET work_mode = ?, updated_at = ? WHERE id = ?').run(workMode, today(), id)
    if (Number(result.changes) !== 1) throw new Error(`no opportunity with id ${id}`)
  }

  setNextAction(id: number, nextAction: string): void {
    this.db.prepare('UPDATE opportunities SET next_action = ? WHERE id = ?').run(nextAction, id)
  }

  setReferral(id: number, referral: string): void {
    this.db.prepare('UPDATE opportunities SET referral = ? WHERE id = ?').run(referral, id)
  }

  setPosting(id: number, state: string, note: string | null): void {
    this.db
      .prepare('UPDATE opportunities SET posting_state = ?, posting_checked = ?, posting_note = ? WHERE id = ?')
      .run(state, now(), note, id)
  }

  /** Marks the row applied after a submit went through, with what was sent in its notes. */
  markApplied(id: number, note: string, runId: number | null): void {
    const day = today()
    this.db
      .prepare(
        `UPDATE opportunities SET status = 'applied', last_touch = ?, updated_at = ?,
          next_action = 'Referral ask once connections accept' WHERE id = ?`,
      )
      .run(day, day, id)
    this.appendNote(id, note)
    this.addEvent(id, `Applied in run ${runId ?? '?'}`, runId)
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM opportunities WHERE id = ?').run(id)
  }

  addEvent(id: number, text: string, runId: number | null): void {
    this.db.prepare('INSERT INTO opportunity_events (opportunity_id, at, text, run_id) VALUES (?, ?, ?, ?)').run(id, now(), text, runId)
  }

  events(id: number): OpportunityEvent[] {
    return this.db
      .prepare('SELECT id, at, text, run_id AS runId FROM opportunity_events WHERE opportunity_id = ? ORDER BY at DESC, id DESC')
      .all(id)
      .map(row => ({ ...row }) as OpportunityEvent)
  }
}
