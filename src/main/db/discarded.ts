import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { DISCARD_REASONS } from '../../shared/types'
import type { DiscardedPage, DiscardedPosting, DiscardedQuery, DiscardReason } from '../../shared/types'
import type { Companies } from './companies'
import { now, paging } from './database'

export const DISCARDED_PAGE_SIZE = 15

const COLUMNS = 'id, at, company, role, portal, job_id AS jobId, link, line, reason, run_id AS runId'

export const isDiscardReason = (value: string): value is DiscardReason =>
  (DISCARD_REASONS as readonly string[]).includes(value)

export type NewDiscard = Omit<DiscardedPosting, 'id' | 'at' | 'runId'>

/** Postings the hunt ruled out, each with the line that ruled it out. The company stays eligible. */
export class Discarded {
  constructor(
    private readonly db: DatabaseSync,
    private readonly companies: Companies,
  ) {}

  add(posting: NewDiscard, runId: number | null): number {
    if (!posting.line.trim()) throw new Error('A discard needs the posting line that ruled it out.')
    const result = this.db
      .prepare(`INSERT INTO discarded (at, company, role, portal, job_id, link, line, reason, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(now(), posting.company, posting.role, posting.portal, posting.jobId, posting.link, posting.line.trim(), posting.reason, runId)
    const id = Number(result.lastInsertRowid)
    this.companies.attach('discarded', id, posting.company)
    return id
  }

  get(id: number): DiscardedPosting | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM discarded WHERE id = ?`).get(id)
    return row ? ({ ...row } as DiscardedPosting) : null
  }

  /** Whether this posting was already discarded: the hunt skips it rather than reading it again. */
  has(portal: string, jobId: string): boolean {
    if (!jobId) return false
    return Boolean(this.db.prepare('SELECT 1 FROM discarded WHERE lower(portal) = lower(?) AND job_id = ? LIMIT 1').get(portal, jobId))
  }

  page(query: DiscardedQuery): DiscardedPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (isDiscardReason(query.reason)) {
      where.push('reason = ?')
      params.push(query.reason)
    }
    const search = query.search.trim().toLowerCase()
    if (search) {
      where.push('(lower(company) LIKE ? OR lower(role) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM discarded ${clause}`).get(...params) as { n: number }).n)
    const { at, pages } = paging(total, query.page, DISCARDED_PAGE_SIZE)
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM discarded ${clause} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, DISCARDED_PAGE_SIZE, at * DISCARDED_PAGE_SIZE)
      .map(row => ({ ...row }) as DiscardedPosting)
    return { rows, total, page: at, pages, pageSize: DISCARDED_PAGE_SIZE }
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM discarded').get() as { n: number }).n)
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM discarded WHERE id = ?').run(id)
  }
}
