import type { DatabaseSync } from 'node:sqlite'

import type { EmailRef, EmailWaiting } from '../../shared/types'
import type { Companies } from './companies'
import { now } from './database'

/** A change as stored, before the screens join it to its row or contact. */
export type StoredChange = {
  id: number
  runId: number | null
  at: string
  kind: 'row' | 'contact'
  targetId: number
  from: string
  to: string
  note: string
  email: EmailRef
  undone: boolean
}

const CHANGE = `id, run_id AS runId, at, kind, target_id AS targetId, from_state AS "from", to_state AS "to", note,
  email_subject AS subject, email_from AS sender, email_date AS date, email_link AS link, undone_at AS undoneAt`

const WAITING = `id, run_id AS runId, at, company, role, summary, email_subject AS subject, email_from AS sender,
  email_date AS date, email_link AS link, state`

type Row = Record<string, unknown>

const changeOf = (row: Row): StoredChange => ({
  id: Number(row['id']),
  runId: row['runId'] === null ? null : Number(row['runId']),
  at: String(row['at']),
  kind: row['kind'] === 'contact' ? 'contact' : 'row',
  targetId: Number(row['targetId']),
  from: String(row['from']),
  to: String(row['to']),
  note: String(row['note']),
  email: { subject: String(row['subject']), from: String(row['sender']), date: String(row['date']), link: String(row['link']) },
  undone: row['undoneAt'] !== null,
})

const waitingOf = (row: Row): EmailWaiting => ({
  id: Number(row['id']),
  runId: row['runId'] === null ? null : Number(row['runId']),
  at: String(row['at']),
  company: String(row['company']),
  role: String(row['role']),
  summary: String(row['summary']),
  email: { subject: String(row['subject']), from: String(row['sender']), date: String(row['date']), link: String(row['link']) },
  state: row['state'] === 'added' ? 'added' : row['state'] === 'ignored' ? 'ignored' : 'waiting',
})

/**
 * What the email check keeps: the emails it has read (so the next check skips
 * them), each change it made with the email behind it, and jobs it found in
 * email that the tracker does not have yet.
 */
export class EmailStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly companies: Companies,
  ) {}

  /** An email as the check knows it: its thread and the date of its newest message, so a reply counts as new. */
  static keyOf(threadId: string, date: string): string {
    return `${threadId}|${date}`
  }

  isSeen(key: string): boolean {
    return this.db.prepare('SELECT 1 FROM email_seen WHERE key = ?').get(key) !== undefined
  }

  /** Records the emails a check listed, and which of them it opened. */
  markSeen(entries: { key: string; threadId: string; opened: boolean }[], runId: number | null): void {
    const insert = this.db.prepare(
      `INSERT INTO email_seen (key, thread_id, run_id, seen_at, opened) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET opened = max(opened, excluded.opened)`,
    )
    for (const entry of entries) insert.run(entry.key, entry.threadId, runId, now(), entry.opened ? 1 : 0)
  }

  /** How many emails a check listed and opened. */
  runCounts(runId: number): { listed: number; opened: number } {
    const row = this.db.prepare('SELECT COUNT(*) AS listed, COALESCE(SUM(opened), 0) AS opened FROM email_seen WHERE run_id = ?').get(runId) as { listed: number; opened: number }
    return { listed: Number(row.listed), opened: Number(row.opened) }
  }

  addChange(change: Omit<StoredChange, 'id' | 'at' | 'undone'>): number {
    const result = this.db
      .prepare(
        `INSERT INTO email_changes (run_id, at, kind, target_id, from_state, to_state, note, email_subject, email_from, email_date, email_link)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(change.runId, now(), change.kind, change.targetId, change.from, change.to, change.note, change.email.subject, change.email.from, change.email.date, change.email.link)
    return Number(result.lastInsertRowid)
  }

  change(id: number): StoredChange | null {
    const row = this.db.prepare(`SELECT ${CHANGE} FROM email_changes WHERE id = ?`).get(id) as Row | undefined
    return row ? changeOf(row) : null
  }

  changes(runId: number): StoredChange[] {
    return this.db.prepare(`SELECT ${CHANGE} FROM email_changes WHERE run_id = ? ORDER BY id`).all(runId).map(row => changeOf(row as Row))
  }

  markUndone(id: number): void {
    this.db.prepare('UPDATE email_changes SET undone_at = ? WHERE id = ?').run(now(), id)
  }

  addWaiting(job: Omit<EmailWaiting, 'id' | 'at' | 'state'>): number {
    const result = this.db
      .prepare(
        `INSERT INTO email_waiting (run_id, at, company, role, summary, email_subject, email_from, email_date, email_link)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(job.runId, now(), job.company, job.role, job.summary, job.email.subject, job.email.from, job.email.date, job.email.link)
    const id = Number(result.lastInsertRowid)
    this.companies.attach('email_waiting', id, job.company)
    return id
  }

  waitingById(id: number): EmailWaiting | null {
    const row = this.db.prepare(`SELECT ${WAITING} FROM email_waiting WHERE id = ?`).get(id) as Row | undefined
    return row ? waitingOf(row) : null
  }

  /** Jobs from email still waiting for the user, newest first; or every one a check kept. */
  waiting(runId?: number): EmailWaiting[] {
    const rows = runId === undefined
      ? this.db.prepare(`SELECT ${WAITING} FROM email_waiting WHERE state = 'waiting' ORDER BY id DESC`).all()
      : this.db.prepare(`SELECT ${WAITING} FROM email_waiting WHERE run_id = ? ORDER BY id`).all(runId)
    return rows.map(row => waitingOf(row as Row))
  }

  setWaiting(id: number, state: 'added' | 'ignored', rowId: number | null = null): void {
    this.db.prepare('UPDATE email_waiting SET state = ?, row_id = ? WHERE id = ?').run(state, rowId, id)
  }

  /** Changes that still stand from one check, for Home. */
  standing(runId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM email_changes WHERE run_id = ? AND undone_at IS NULL AND kind = 'row'").get(runId) as { n: number }
    return Number(row.n)
  }
}
