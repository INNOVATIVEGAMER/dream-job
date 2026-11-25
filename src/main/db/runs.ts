import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { FLOWS } from '../../shared/types'
import type { Flow, LaneStatus, RunEvent, RunEventKind, RunLane, RunPage, RunQuery, RunState, RunStatus, RunSummary, RunUsage } from '../../shared/types'
import { now, paging } from './database'

export const RUNS_PAGE_SIZE = 15

const COLUMNS = `id, flow, title, portal, job_id AS jobId, started, ended, status, result,
  turns, input_tokens AS inputTokens, output_tokens AS outputTokens, ms`

type RunRow = Omit<RunSummary, 'usage'> & RunUsage

const toSummary = (row: RunRow): RunSummary => ({
  id: row.id,
  flow: row.flow,
  title: row.title,
  portal: row.portal,
  jobId: row.jobId,
  started: row.started,
  ended: row.ended,
  status: row.status,
  result: row.result,
  usage: { turns: row.turns, inputTokens: row.inputTokens, outputTokens: row.outputTokens, ms: row.ms },
})

/** Every flow run, with its activity log and the Claude usage it took. */
export class Runs {
  constructor(private readonly db: DatabaseSync) {}

  start(flow: Flow, title: string, portal: string | null, jobId: number | null, subtitle: string | null, atOnce: number): number {
    const result = this.db
      .prepare(`INSERT INTO runs (flow, title, portal, job_id, started, status, subtitle, at_once) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`)
      .run(flow, title, portal, jobId, now(), subtitle, atOnce)
    return Number(result.lastInsertRowid)
  }

  /** Saves one session as it stands: written when the run starts, and again each time it moves on. */
  saveLane(runId: number, lane: RunLane): void {
    this.db
      .prepare(
        `INSERT INTO run_lanes (run_id, key, title, subtitle, portal, job_id, status, started, ended, result, turns, input_tokens, output_tokens, ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id, key) DO UPDATE SET status = excluded.status, started = excluded.started, ended = excluded.ended, result = excluded.result,
           turns = excluded.turns, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, ms = excluded.ms`,
      )
      .run(
        runId,
        lane.key,
        lane.title,
        lane.subtitle,
        lane.portal,
        lane.jobId,
        lane.status,
        lane.started,
        lane.ended,
        lane.result,
        lane.usage.turns,
        lane.usage.inputTokens,
        lane.usage.outputTokens,
        lane.usage.ms,
      )
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
    const at = now()
    this.db
      .prepare(
        `UPDATE run_lanes SET status = 'stopped', ended = COALESCE(ended, ?), result = COALESCE(result, 'The app closed during the run.')
         WHERE status IN ('running', 'waiting', 'queued') AND run_id IN (SELECT id FROM runs WHERE status IN ('running', 'waiting'))`,
      )
      .run(at)
    this.db.prepare(`UPDATE runs SET status = 'stopped', result = 'The app closed during the run.', ended = ? WHERE status IN ('running', 'waiting')`).run(at)
  }

  /** One step, with the session it came from; a line about the whole run has none. */
  addEvent(runId: number, kind: RunEventKind, text: string, lane: string | null = null): RunEvent {
    const at = now()
    const result = this.db.prepare('INSERT INTO run_events (run_id, at, kind, text, lane) VALUES (?, ?, ?, ?, ?)').run(runId, at, kind, text, lane)
    return { id: Number(result.lastInsertRowid), at, kind, text }
  }

  /**
   * A past run as its screen showed it: every session with its own steps.
   * Null for a run whose sessions were never saved, from before they were.
   */
  state(id: number): RunState | null {
    const summary = this.get(id)
    if (!summary) return null
    const rows = this.db.prepare('SELECT * FROM run_lanes WHERE run_id = ? ORDER BY CAST(key AS INTEGER)').all(id) as Record<string, unknown>[]
    if (rows.length === 0) return null
    const extra = this.db.prepare('SELECT subtitle, at_once AS atOnce FROM runs WHERE id = ?').get(id) as { subtitle: string | null; atOnce: number }
    const steps = this.db.prepare('SELECT id, at, kind, text, lane FROM run_events WHERE run_id = ? ORDER BY id ASC').all(id) as (RunEvent & { lane: string | null })[]
    const isMany = rows.length > 1
    const lanes: RunLane[] = rows.map(row => {
      const key = String(row['key'])
      const title = String(row['title'])
      // With several sessions each step was saved with its session's name in front; the session's own list leaves it off.
      const events = steps
        .filter(step => step.lane === key)
        .map(({ lane: _lane, ...step }) => ({ ...step, text: isMany && step.text.startsWith(`${title}: `) ? step.text.slice(title.length + 2) : step.text }))
      const said = events.filter(event => event.kind !== 'claude' && event.kind !== 'tool')
      return {
        key,
        title,
        subtitle: (row['subtitle'] as string | null) ?? null,
        portal: (row['portal'] as string | null) ?? null,
        jobId: (row['job_id'] as number | null) ?? null,
        status: row['status'] as LaneStatus,
        started: (row['started'] as string | null) ?? null,
        ended: (row['ended'] as string | null) ?? null,
        progress: null,
        counts: {},
        card: null,
        form: null,
        events,
        last: said[said.length - 1]?.text ?? null,
        usage: { turns: Number(row['turns']), inputTokens: Number(row['input_tokens']), outputTokens: Number(row['output_tokens']), ms: Number(row['ms']) },
        result: (row['result'] as string | null) ?? null,
      }
    })
    return {
      id: summary.id,
      flow: summary.flow,
      title: summary.title,
      subtitle: extra.subtitle,
      portal: summary.portal,
      jobId: summary.jobId,
      status: summary.status,
      started: summary.started,
      model: null,
      progress: null,
      counts: {},
      card: null,
      events: steps.map(({ lane: _lane, ...step }) => step),
      usage: summary.usage,
      result: summary.result,
      lanes,
      atOnce: extra.atOnce,
    }
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
