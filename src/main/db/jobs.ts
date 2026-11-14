import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { linkKey } from '../../shared/links'
import { isSource, isStatus, STATUS_NAMES, WORK_MODES, workModeOf } from '../../shared/types'
import type { DiscardReason, Job, JobRow, NewJob, PostingState, Source, Status, WorkMode } from '../../shared/types'
import type { ActivityLog } from './activity'
import type { Companies } from './companies'
import { companyKey, now, today } from './database'

/** A job as the tracker's rows show it, its company's name joined in and its newest activity as `updated`. */
export const JOB_ROW = `j.id, j.company_id AS companyId, c.name AS company, j.role, j.status, j.portal, j.link, j.portal_link AS portalLink,
  j.posting_state AS postingState, j.work_mode AS workMode, j.min_years AS minYears, j.score,
  j.discard_reason AS discardReason, j.discard_line AS discardLine,
  COALESCE((SELECT MAX(a.at) FROM activity a WHERE a.job_id = j.id), j.updated_at, j.found) AS updated`

export const JOB_FROM = 'jobs j JOIN companies c ON c.id = j.company_id'

const FULL = `${JOB_ROW}, j.found, j.req_id AS reqId, j.apply_route AS applyRoute, j.posting_checked AS postingChecked,
  j.posting_note AS postingNote, j.pay, j.applicants, j.score_reasons AS scoreReasons, j.notes`

function parseReasons(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const toRow = (row: unknown): JobRow => ({ ...(row as JobRow) })

/** A posting a hunt adds as found. */
export type FoundJob = {
  company: string
  stage: string
  role: string
  portal: Source
  /** The posting on its portal: no two jobs share one. */
  portalLink: string
  /** Where the application goes: the company's own page when applying leaves the portal. */
  link: string
  /** The company's own id for the job, when the posting states it. */
  reqId: string | null
  /** `unreadable` when the company's page could not be read, so the portal's facts stand. */
  postingState: 'open' | 'unreadable'
  postingNote: string | null
  workMode: WorkMode
  minYears: number | null
  applicants: string
  pay: string | null
  applyRoute: string | null
  score: number
  scoreReasons: string[]
  notes: string
}

/** A posting a hunt rules out, kept as a discarded job with the posting's words that ruled it out. */
export type DiscardedJob = { company: string; role: string; portal: Source; portalLink: string | null; line: string; reason: DiscardReason }

/**
 * Jobs: every posting from the day it was found or discarded to its end.
 * Each belongs to a company and copies nothing from it; its history is in
 * Activity.
 */
export class Jobs {
  constructor(
    private readonly db: DatabaseSync,
    private readonly companies: Companies,
    private readonly activity: ActivityLog,
  ) {}

  get(id: number): Job | null {
    const row = this.db.prepare(`SELECT ${FULL} FROM ${JOB_FROM} WHERE j.id = ?`).get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return { ...(row as unknown as Job), reqId: (row['reqId'] as string | null) || null, scoreReasons: parseReasons(row['scoreReasons']) }
  }

  row(id: number): JobRow | null {
    const row = this.db.prepare(`SELECT ${JOB_ROW} FROM ${JOB_FROM} WHERE j.id = ?`).get(id)
    return row ? toRow(row) : null
  }

  private rows(where: string, params: SQLInputValue[], order = 'updated DESC, j.id DESC'): JobRow[] {
    return this.db.prepare(`SELECT ${JOB_ROW} FROM ${JOB_FROM} WHERE ${where} ORDER BY ${order}`).all(...params).map(toRow)
  }

  /** A company's jobs, newest activity first. */
  forCompany(companyId: number): JobRow[] {
    return this.rows('j.company_id = ?', [companyId])
  }

  /** Jobs at any of `statuses`, found first, then best score. */
  withStatuses(statuses: readonly string[]): JobRow[] {
    if (statuses.length === 0) return []
    return this.rows(`j.status IN (${statuses.map(() => '?').join(', ')})`, [...statuses], "j.status = 'found' DESC, j.score DESC, j.id ASC")
  }

  /** The jobs a hunt found: their found row names the run. Best score first. */
  byRun(runId: number): JobRow[] {
    return this.rows("j.id IN (SELECT job_id FROM activity WHERE run_id = ? AND kind = 'status' AND to_state = 'found')", [runId], 'j.score DESC, j.id ASC')
  }

  counts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all()) {
      const { status, n } = row as { status: string; n: number }
      counts[status] = Number(n)
    }
    return counts
  }

  /** The job with this posting link, whatever its status: how a hunt recognises a posting it has seen. */
  byPortalLink(portalLink: string): JobRow | null {
    const exact = this.db.prepare(`SELECT ${JOB_ROW} FROM ${JOB_FROM} WHERE j.portal_link = ?`).get(portalLink)
    if (exact) return toRow(exact)
    const key = linkKey(portalLink)
    return this.rows('j.portal_link IS NOT NULL', []).find(row => row.portalLink && linkKey(row.portalLink) === key) ?? null
  }

  /**
   * A job from this portal whose posting link carries this id: how a hunt
   * recognises a search card, discarded ones too, before it reads the posting.
   * Every posting link the app saves is built from the portal's id.
   */
  byPortalId(portal: Source, jobId: string): JobRow | null {
    const wanted = jobId.trim().toLowerCase()
    if (!wanted) return null
    if (/^https?:\/\//.test(wanted)) return this.byPortalLink(jobId)
    return (
      this.rows('j.portal = ? AND j.portal_link IS NOT NULL', [portal]).find(row => {
        const parts = row.portalLink!.toLowerCase().split(/[/?=&#]+/)
        return parts.includes(wanted) || parts.includes(`job-${wanted}`)
      }) ?? null
    )
  }

  /**
   * A job already tracked for this posting: the same posting link, the same
   * apply page whichever portal showed it, or the same company and role.
   */
  findExisting(posting: { portalLink?: string | null; link?: string | null; company: string; role: string }): JobRow | null {
    if (posting.portalLink) {
      const byPosting = this.byPortalLink(posting.portalLink)
      if (byPosting) return byPosting
    }
    if (posting.link) {
      const key = linkKey(posting.link)
      const byApply = this.rows('j.link IS NOT NULL', []).find(row => row.link && linkKey(row.link) === key)
      if (byApply) return byApply
    }
    const company = this.companies.byName(posting.company)
    if (!company) return null
    const role = posting.role.trim().toLowerCase()
    return this.forCompany(company.id).find(row => row.role.trim().toLowerCase() === role) ?? null
  }

  private insert(fields: Record<string, SQLInputValue>): number {
    const names = Object.keys(fields)
    const result = this.db
      .prepare(`INSERT INTO jobs (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
      .run(...names.map(name => fields[name]!))
    return Number(result.lastInsertRowid)
  }

  addFound(posting: FoundJob, runId: number | null): number {
    const companyId = this.companies.resolve(posting.company, posting.stage)
    const id = this.insert({
      company_id: companyId,
      role: posting.role.trim(),
      status: 'found',
      found: today(),
      portal: posting.portal,
      portal_link: posting.portalLink,
      link: posting.link || null,
      req_id: posting.reqId,
      apply_route: posting.applyRoute,
      posting_state: posting.postingState,
      posting_note: posting.postingNote,
      posting_checked: now(),
      work_mode: posting.workMode,
      pay: posting.pay,
      min_years: posting.minYears,
      applicants: posting.applicants,
      score: posting.score,
      score_reasons: JSON.stringify(posting.scoreReasons),
      notes: posting.notes,
      updated_at: now(),
    })
    this.activity.add({ kind: 'status', jobId: id, toState: 'found', text: `Found by a hunt on ${posting.portal}`, runId })
    return id
  }

  addDiscarded(posting: DiscardedJob, runId: number | null): number {
    const companyId = this.companies.resolve(posting.company)
    const id = this.insert({
      company_id: companyId,
      role: posting.role.trim(),
      status: 'discarded',
      found: today(),
      portal: posting.portal,
      portal_link: posting.portalLink,
      discard_reason: posting.reason,
      discard_line: posting.line,
      updated_at: now(),
    })
    this.activity.add({ kind: 'status', jobId: id, toState: 'discarded', text: `Discarded by a hunt on ${posting.portal}: "${posting.line}"`, runId })
    return id
  }

  /** A job you add by hand: it needs a link, and starts at the status you pick. */
  addManual(input: NewJob): number {
    const link = input.link.trim()
    if (!link) throw new Error('Add a link to the posting or the apply page.')
    if (!isStatus(input.status) || input.status === 'discarded') throw new Error(`${input.status} is not a status a new job can start at.`)
    const portal = isSource(input.portal) ? input.portal : 'manual'
    if (this.byPortalLink(link) ?? this.findExisting({ link, company: input.company, role: input.role })) throw new Error('That job is already in your tracker.')
    const companyId = this.companies.resolve(input.company, input.stage)
    const id = this.insert({
      company_id: companyId,
      role: input.role.trim(),
      status: input.status,
      found: today(),
      portal,
      // A link you paste is the posting and the apply page both, until a run reads it.
      portal_link: portal === 'manual' ? null : link,
      link,
      req_id: input.reqId.trim() || null,
      work_mode: input.workMode ?? workModeOf(''),
      notes: input.notes.trim(),
      updated_at: now(),
    })
    this.activity.add({ kind: 'status', jobId: id, toState: input.status, text: 'Added by you' })
    return id
  }

  /** Moves a job to a status and records the move; returns the Activity row's id. */
  setStatus(id: number, status: string, cause: { runId?: number | null; emailId?: number | null; text?: string } = {}): number {
    if (!isStatus(status)) throw new Error(`${status} is not a job status`)
    const job = this.row(id)
    if (!job) throw new Error(`no job with id ${id}`)
    this.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
    return this.activity.add({
      kind: 'status',
      jobId: id,
      fromState: job.status,
      toState: status,
      text: cause.text ?? `Status set to ${STATUS_NAMES[status].toLowerCase()}`,
      runId: cause.runId ?? null,
      emailId: cause.emailId ?? null,
    })
  }

  /** Rules a job out after all, with the posting's words that ruled it out. */
  discard(id: number, line: string, reason: DiscardReason, runId: number | null): void {
    this.db.prepare('UPDATE jobs SET discard_reason = ?, discard_line = ? WHERE id = ?').run(reason, line, id)
    this.setStatus(id, 'discarded', { runId, text: `Discarded: "${line}"` })
  }

  /** A discarded job back to found, ready to apply to. */
  restore(id: number): void {
    const job = this.row(id)
    if (!job) throw new Error(`no job with id ${id}`)
    if (job.status !== 'discarded') throw new Error('Only a discarded job can be restored.')
    this.setStatus(id, 'found', { text: `Restored by you. It had been ruled out by: "${job.discardLine ?? ''}"` })
  }

  setNotes(id: number, notes: string): void {
    const result = this.db.prepare('UPDATE jobs SET notes = ?, updated_at = ? WHERE id = ?').run(notes, now(), id)
    if (Number(result.changes) !== 1) throw new Error(`no job with id ${id}`)
  }

  /** Adds a dated paragraph to the notes: what a run recorded. */
  appendNote(id: number, text: string): void {
    const job = this.get(id)
    if (!job) throw new Error(`no job with id ${id}`)
    const note = `${today()}: ${text.trim()}`
    this.setNotes(id, job.notes.trim() ? `${job.notes.trim()}\n\n${note}` : note)
  }

  /**
   * Saves the links and route a run read off the pages; a value left out keeps
   * what is there. A posting link another job already holds is left off.
   */
  setLinks(id: number, links: { link?: string | null; portalLink?: string | null; applyRoute?: string | null }): void {
    const current = this.get(id)
    if (!current) throw new Error(`no job with id ${id}`)
    let portalLink = links.portalLink ?? current.portalLink
    if (portalLink && portalLink !== current.portalLink) {
      const holder = this.byPortalLink(portalLink)
      if (holder && holder.id !== id) portalLink = current.portalLink
    }
    this.db
      .prepare('UPDATE jobs SET link = ?, portal_link = ?, apply_route = ?, updated_at = ? WHERE id = ?')
      .run(links.link ?? current.link, portalLink, links.applyRoute ?? current.applyRoute, now(), id)
  }

  /** The links you paste on the job page: the posting, and where the application goes. Empty clears one. */
  setLinksByUser(id: number, portalLink: string | null, link: string | null): void {
    if (portalLink) {
      const holder = this.byPortalLink(portalLink)
      if (holder && holder.id !== id) throw new Error(`That posting is already ${holder.company}, ${holder.role}.`)
    }
    const result = this.db.prepare('UPDATE jobs SET portal_link = ?, link = ?, updated_at = ? WHERE id = ?').run(portalLink, link, now(), id)
    if (Number(result.changes) !== 1) throw new Error(`no job with id ${id}`)
    this.activity.add({ kind: 'note', jobId: id, text: 'Links set by you' })
  }

  /** The company's own id for the job, as the posting shows it. Empty clears it. */
  setReqId(id: number, reqId: string | null): void {
    const result = this.db.prepare('UPDATE jobs SET req_id = ?, updated_at = ? WHERE id = ?').run(reqId?.trim() || null, now(), id)
    if (Number(result.changes) !== 1) throw new Error(`no job with id ${id}`)
  }

  /** The fewest years of experience the job asks for, saved only with the posting's words as proof. */
  setMinYears(id: number, minYears: number): void {
    this.db.prepare('UPDATE jobs SET min_years = ?, updated_at = ? WHERE id = ?').run(minYears, now(), id)
  }

  setWorkMode(id: number, workMode: WorkMode): void {
    if (!(WORK_MODES as readonly string[]).includes(workMode)) throw new Error(`${workMode} is not a work mode`)
    const result = this.db.prepare('UPDATE jobs SET work_mode = ?, updated_at = ? WHERE id = ?').run(workMode, now(), id)
    if (Number(result.changes) !== 1) throw new Error(`no job with id ${id}`)
  }

  setPosting(id: number, state: PostingState, note: string | null): void {
    this.db.prepare('UPDATE jobs SET posting_state = ?, posting_checked = ?, posting_note = ? WHERE id = ?').run(state, now(), note, id)
  }

  /** Marks the job applied after a submit went through, with what was sent in its notes. */
  markApplied(id: number, note: string, runId: number | null): void {
    this.setStatus(id, 'applied', { runId, text: `Applied in run ${runId ?? '?'}` })
    this.appendNote(id, note)
  }

  /** The newest job at a company in one of `statuses`. */
  newestAt(companyId: number, statuses: readonly Status[]): JobRow | null {
    return this.forCompany(companyId).find(row => statuses.includes(row.status)) ?? null
  }

  /** A company's jobs by its name, however it is spelled. */
  forCompanyName(name: string): JobRow[] {
    const company = this.companies.byName(name)
    if (company) return this.forCompany(company.id)
    const key = companyKey(name)
    return this.rows('1 = 1', []).filter(row => companyKey(row.company) === key)
  }
}
