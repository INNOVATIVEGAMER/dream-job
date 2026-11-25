import type { DatabaseSync } from 'node:sqlite'

import { answerOf } from '../../shared/form'
import type { Application, ApplicationForm, FormField } from '../../shared/types'
import { now } from './database'

const COLUMNS = 'id, job_id AS jobId, run_id AS runId, lane, sent, route, by_user AS byUser, url, title, fields'

type Row = Omit<Application, 'byUser' | 'fields'> & { lane: string | null; byUser: number; fields: string }

function fieldsOf(text: string): FormField[] {
  try {
    const fields: unknown = JSON.parse(text)
    return Array.isArray(fields) ? (fields as FormField[]) : []
  } catch {
    return []
  }
}

const toApplication = ({ lane: _lane, ...row }: Row): Application => ({ ...row, byUser: row.byUser === 1, fields: fieldsOf(row.fields) })

/** How an earlier application answered one question. */
export type PastAnswer = { jobId: number; sent: string; question: string; answer: string; isWritten: boolean }

/**
 * Every application that went out, each with its form as it was sent: the
 * questions, and the answer each field held when the last button was pressed.
 */
export class Applications {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Keeps an application that went out. Each answer is saved as it went: one
   * the user set stands in for what the page held, so nothing is left pending.
   */
  add(entry: { jobId: number; runId: number | null; lane: string | null; route: string; byUser: boolean; form: ApplicationForm | null }): number {
    const fields = (entry.form?.fields ?? []).map(field => ({ ...field, value: answerOf(field), isOnPage: false, isStuck: false }))
    const result = this.db
      .prepare('INSERT INTO applications (job_id, run_id, lane, sent, route, by_user, url, title, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.jobId, entry.runId, entry.lane, entry.form?.sent ?? now(), entry.route, entry.byUser ? 1 : 0, entry.form?.url ?? '', entry.form?.title ?? '', JSON.stringify(fields))
    return Number(result.lastInsertRowid)
  }

  /** A job's applications, newest first. Usually one. */
  forJob(jobId: number): Application[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM applications WHERE job_id = ? ORDER BY id DESC`)
      .all(jobId)
      .map(row => toApplication({ ...row } as Row))
  }

  /** The forms a run sent, by the session each went out in. */
  forRun(runId: number): Map<string, ApplicationForm> {
    const forms = new Map<string, ApplicationForm>()
    for (const row of this.db.prepare(`SELECT ${COLUMNS} FROM applications WHERE run_id = ? ORDER BY id`).all(runId)) {
      const { lane } = row as Row
      const application = toApplication({ ...row } as Row)
      if (lane === null) continue
      forms.set(lane, { url: application.url, title: application.title, page: 0, fields: application.fields, sent: application.sent })
    }
    return forms
  }

  /**
   * How earlier applications answered questions that hold every one of these
   * words, newest first: what was said about notice period, or pay, last time.
   */
  answers(words: string, limit = 40): PastAnswer[] {
    const wanted = words.toLowerCase().split(/\s+/).filter(Boolean)
    if (wanted.length === 0) return []
    const found: PastAnswer[] = []
    for (const row of this.db.prepare(`SELECT ${COLUMNS} FROM applications ORDER BY id DESC LIMIT 500`).all()) {
      const application = toApplication({ ...row } as Row)
      for (const field of application.fields) {
        const question = field.label.toLowerCase()
        if (!field.value.trim() || !wanted.every(word => question.includes(word))) continue
        found.push({ jobId: application.jobId, sent: application.sent, question: field.label, answer: field.value, isWritten: field.isWritten })
        if (found.length >= limit) return found
      }
    }
    return found
  }
}
