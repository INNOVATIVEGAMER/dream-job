import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { ACTIVITY_KINDS } from '../../shared/types'
import type { Activity, ActivityKind } from '../../shared/types'
import { now } from './database'

const COLUMNS = `id, at, kind, job_id AS jobId, person_id AS personId, company_id AS companyId, from_state AS fromState,
  to_state AS toState, text, run_id AS runId, email_id AS emailId, undone_at AS undoneAt`

type Row = Omit<Activity, 'undone'> & { undoneAt: string | null }

const toActivity = ({ undoneAt, ...row }: Row): Activity => ({
  ...row,
  kind: (ACTIVITY_KINDS as readonly string[]).includes(row.kind) ? row.kind : 'note',
  undone: undoneAt !== null,
})

/** What one Activity row records. A person's rows name the company it happened at. */
export type NewActivity = {
  kind: ActivityKind
  text: string
  jobId?: number | null
  personId?: number | null
  companyId?: number | null
  fromState?: string | null
  toState?: string | null
  runId?: number | null
  emailId?: number | null
  /** When it happened, if not now: for history carried over from elsewhere. */
  at?: string
}

/**
 * The one history: everything that happened to a job, a person or an
 * outreach, each with the run or email that caused it. Pages read their
 * timelines from here, and undoing an email's change undoes its row.
 */
export class ActivityLog {
  constructor(private readonly db: DatabaseSync) {}

  add(entry: NewActivity): number {
    const result = this.db
      .prepare(
        `INSERT INTO activity (at, kind, job_id, person_id, company_id, from_state, to_state, text, run_id, email_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.at ?? now(),
        entry.kind,
        entry.jobId ?? null,
        entry.personId ?? null,
        entry.companyId ?? null,
        entry.fromState ?? null,
        entry.toState ?? null,
        entry.text,
        entry.runId ?? null,
        entry.emailId ?? null,
      )
    return Number(result.lastInsertRowid)
  }

  get(id: number): Activity | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM activity WHERE id = ?`).get(id) as Row | undefined
    return row ? toActivity({ ...row }) : null
  }

  markUndone(id: number): void {
    this.db.prepare('UPDATE activity SET undone_at = ? WHERE id = ?').run(now(), id)
  }

  private list(where: string, params: SQLInputValue[], limit = 200): Activity[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM activity WHERE ${where} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(...params, limit)
      .map(row => toActivity({ ...(row as Row) }))
  }

  /** A job's history, newest first. */
  forJob(jobId: number): Activity[] {
    return this.list('job_id = ?', [jobId])
  }

  /** Everything at a company: its jobs' history, and what happened to people while they were there. */
  forCompany(companyId: number): Activity[] {
    return this.list('job_id IN (SELECT id FROM jobs WHERE company_id = ?) OR (job_id IS NULL AND company_id = ?)', [companyId, companyId], 120)
  }

  /** The changes one email check made: rows that name an email the check read. */
  forEmailRun(runId: number): Activity[] {
    return this.list('email_id IN (SELECT id FROM emails WHERE run_id = ?)', [runId], 500).reverse()
  }

  /** When a request to this person went: their first request-sent row. */
  requestedOn(personId: number): string | null {
    const row = this.db.prepare("SELECT MIN(at) AS at FROM activity WHERE person_id = ? AND kind = 'request-sent'").get(personId) as { at: string | null }
    return row.at
  }

  /** Changes from one email check that still stand, for Home. */
  standingFromRun(runId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM activity WHERE undone_at IS NULL AND email_id IN (SELECT id FROM emails WHERE run_id = ?)')
      .get(runId) as { n: number }
    return Number(row.n)
  }
}
