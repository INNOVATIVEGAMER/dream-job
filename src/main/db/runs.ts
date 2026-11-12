import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { FLOWS } from '../../shared/types'
import type { Flow, RunEvent, RunEventKind, RunPage, RunQuery, RunStatus, RunSummary, RunUsage } from '../../shared/types'
import { now, paging } from './database'

export const RUNS_PAGE_SIZE = 15

const COLUMNS = `id, flow, title, portal, opportunity_id AS opportunityId, started, ended, status, result,
  turns, input_tokens AS inputTokens, output_tokens AS outputTokens, ms`

type RunRow = Omit<RunSummary, 'usage'> & RunUsage

const toSummary = (row: RunRow): RunSummary => ({
  id: row.id,
  flow: row.flow,
  title: row.title,
  portal: row.portal,
  opportunityId: row.opportunityId,
  started: row.started,
  ended: row.ended,
  status: row.status,
  result: row.result,
  usage: { turns: row.turns, inputTokens: row.inputTokens, outputTokens: row.outputTokens, ms: row.ms },
})

/** Every flow run, with its activity log and what it used of the Claude plan. */
export class Runs {
  constructor(private readonly db: DatabaseSync) {}

  start(flow: Flow, title: string, portal: string | null, opportunityId: number | null): number {
    const result = this.db
      .prepare(`INSERT INTO runs (flow, title, portal, opportunity_id, started, status) VALUES (?, ?, ?, ?, ?, 'running')`)
      .run(flow, title, portal, opportunityId, now())
    return Number(result.lastInsertRowid)
  }

  setStatus(id: number, status: RunStatus): void {
    this.db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, id)
  }

  setUsage(id: number, usage: RunUsage): void {
    this.db
      .prepare('UPDATE runs SET turns = ?, input_tokens = ?, output_tokens = ?, ms = ? WHERE id = ?')
      .run(usage.turns, usage.inputTokens, usage.outputTokens, usage.ms, id)
  }

  finish(id: number, status: RunStatus, result: string): void {
    this.db.prepare('UPDATE runs SET status = ?, result = ?, ended = ? WHERE id = ?').run(status, result, now(), id)
  }

  /** Runs the app was killed in the middle of: marked stopped on the next start, since nothing is running them. */
  closeAbandoned(): void {
    this.db
      .prepare(`UPDATE runs SET status = 'stopped', result = 'The app closed during the run.', ended = ? WHERE status IN ('running', 'waiting')`)
      .run(now())
  }

  addEvent(runId: number, kind: RunEventKind, text: string): RunEvent {
    const at = now()
    const result = this.db.prepare('INSERT INTO run_events (run_id, at, kind, text) VALUES (?, ?, ?, ?)').run(runId, at, kind, text)
    return { id: Number(result.lastInsertRowid), at, kind, text }
  }

  events(runId: number): RunEvent[] {
    return this.db
      .prepare('SELECT id, at, kind, text FROM run_events WHERE run_id = ? ORDER BY id ASC')
      .all(runId)
      .map(row => ({ ...row }) as RunEvent)
  }

  get(id: number): RunSummary | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM runs WHERE id = ?`).get(id) as RunRow | undefined
    return row ? toSummary({ ...row }) : null
  }

  page(query: RunQuery): RunPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if ((FLOWS as readonly string[]).includes(query.flow)) {
      where.push('flow = ?')
      params.push(query.flow)
    }
    if (query.portal && query.portal !== 'all') {
      where.push('portal LIKE ?')
      params.push(`%${query.portal}%`)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM runs ${clause}`).get(...params) as { n: number }).n)
    const { at, pages } = paging(total, query.page, RUNS_PAGE_SIZE)
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM runs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, RUNS_PAGE_SIZE, at * RUNS_PAGE_SIZE)
      .map(row => toSummary({ ...(row as RunRow) }))
    return { rows, total, page: at, pages, pageSize: RUNS_PAGE_SIZE }
  }

  recent(limit: number): RunSummary[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM runs ORDER BY id DESC LIMIT ?`)
      .all(limit)
      .map(row => toSummary({ ...(row as RunRow) }))
  }

  last(flow: Flow): RunSummary | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM runs WHERE flow = ? ORDER BY id DESC LIMIT 1`).get(flow) as RunRow | undefined
    return row ? toSummary({ ...row }) : null
  }
}
