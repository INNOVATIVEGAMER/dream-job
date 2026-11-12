import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { STATUSES } from '../shared/types'
import type { TrackerPage, TrackerRow } from '../shared/types'

/** The opportunities table: the columns the 96 kept rows came with. */
const SCHEMA = `CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY,
  found TEXT NOT NULL,
  company TEXT NOT NULL,
  stage TEXT NOT NULL,
  role TEXT NOT NULL,
  portal TEXT NOT NULL,
  job_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  applicants TEXT NOT NULL,
  referral TEXT NOT NULL,
  score INTEGER,
  status TEXT NOT NULL,
  last_touch TEXT NOT NULL,
  next_action TEXT NOT NULL,
  notes TEXT NOT NULL,
  updated_at TEXT,
  link TEXT,
  posting_state TEXT,
  posting_checked TEXT,
  posting_note TEXT
);`

const COLUMNS = `id, company, role, stage, score, status, last_touch AS lastTouch,
  next_action AS nextAction, portal, job_id AS jobId, link, posting_state AS postingState`

export const PAGE_SIZE = 15

const isStatus = (value: string): boolean => (STATUSES as readonly string[]).includes(value)

/**
 * The tracker's data: `data/job.db` in the app's own repo, read and written
 * by the main process alone, through Node's built-in SQLite.
 */
export class Tracker {
  private readonly db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(SCHEMA)
  }

  /** One page of rows, newest touch first, filtered by status or `all`. */
  page(filter: string, page: number): TrackerPage {
    const isAll = filter === 'all' || !isStatus(filter)
    const where = isAll ? '' : 'WHERE status = ?'
    const params = isAll ? [] : [filter]

    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM opportunities ${where}`).get(...params) as { n: number }).n)
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const at = Math.min(Math.max(0, Math.trunc(page) || 0), pages - 1)
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM opportunities ${where} ORDER BY last_touch DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, PAGE_SIZE, at * PAGE_SIZE)
      .map(row => ({ ...row }) as TrackerRow)

    const counts: Record<string, number> = {}
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS n FROM opportunities GROUP BY status').all()) {
      const { status, n } = row as { status: string; n: number }
      counts[status] = Number(n)
    }
    const all = Object.values(counts).reduce((sum, n) => sum + n, 0)

    return { rows, total, all, counts, page: at, pages, pageSize: PAGE_SIZE }
  }

  /** Saves a status, dating the change. Refuses a status outside the known set or an unknown row. */
  setStatus(id: number, status: string): void {
    if (!isStatus(status)) throw new Error(`${status} is not a tracker status`)
    const today = new Date().toISOString().slice(0, 10)
    const result = this.db.prepare('UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?').run(status, today, id)
    if (Number(result.changes) !== 1) throw new Error(`no opportunity with id ${id}`)
  }

  close(): void {
    this.db.close()
  }
}
