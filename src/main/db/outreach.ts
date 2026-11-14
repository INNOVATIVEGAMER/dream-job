import type { DatabaseSync } from 'node:sqlite'

import { OUTREACH_STATES } from '../../shared/types'
import type { JobOutreach, Outreach, OutreachState } from '../../shared/types'
import { now } from './database'

const COLUMNS = 'o.id, o.job_id AS jobId, o.person_id AS personId, o.message, o.resume, o.state, o.sent'

export const isOutreachState = (value: string): value is OutreachState => (OUTREACH_STATES as readonly string[]).includes(value)

const toOutreach = (row: unknown): Outreach => {
  const value = row as Omit<Outreach, 'resume'> & { resume: number }
  return { ...value, resume: Boolean(value.resume) }
}

/**
 * Outreach: each referral message, joining one job and one person at its
 * company. A row exists only once a message has gone, never changes after,
 * and you set where the ask stands.
 */
export class OutreachStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Records a message that went. One per job and person: a second one about the same job is refused. */
  add(entry: { jobId: number; personId: number; message: string; resume: boolean }): number {
    if (this.find(entry.jobId, entry.personId)) throw new Error('That person was already asked about this job.')
    const result = this.db
      .prepare("INSERT INTO outreach (job_id, person_id, message, resume, state, sent) VALUES (?, ?, ?, ?, 'sent', ?)")
      .run(entry.jobId, entry.personId, entry.message, entry.resume ? 1 : 0, now())
    return Number(result.lastInsertRowid)
  }

  get(id: number): Outreach | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM outreach o WHERE o.id = ?`).get(id)
    return row ? toOutreach(row) : null
  }

  find(jobId: number, personId: number): Outreach | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM outreach o WHERE o.job_id = ? AND o.person_id = ?`).get(jobId, personId)
    return row ? toOutreach(row) : null
  }

  setState(id: number, state: OutreachState): void {
    const result = this.db.prepare('UPDATE outreach SET state = ? WHERE id = ?').run(state, id)
    if (Number(result.changes) !== 1) throw new Error(`no outreach with id ${id}`)
  }

  /** Who was asked about a job, with whether each still works at its company. */
  forJob(jobId: number): JobOutreach[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS}, p.name, p.headline, p.profile_url AS profileUrl,
           COALESCE((SELECT ps.current FROM positions ps JOIN jobs j ON j.company_id = ps.company_id WHERE j.id = o.job_id AND ps.person_id = o.person_id), 0) AS current
         FROM outreach o JOIN people p ON p.id = o.person_id WHERE o.job_id = ? ORDER BY o.sent ASC, o.id ASC`,
      )
      .all(jobId)
      .map(row => {
        const value = row as Omit<JobOutreach, 'resume' | 'current'> & { resume: number; current: number }
        return { ...value, resume: Boolean(value.resume), current: Boolean(value.current) }
      })
  }

  /** Every ask about a company's jobs, by person: what each was asked. */
  forCompany(companyId: number): (Outreach & { role: string })[] {
    return this.db
      .prepare(`SELECT ${COLUMNS}, j.role FROM outreach o JOIN jobs j ON j.id = o.job_id WHERE j.company_id = ? ORDER BY o.sent ASC, o.id ASC`)
      .all(companyId)
      .map(row => ({ ...toOutreach(row), role: (row as { role: string }).role }))
  }

  /** How many asks went about a job. */
  countFor(jobId: number): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM outreach WHERE job_id = ?').get(jobId) as { n: number }).n)
  }
}
