import type { DatabaseSync } from 'node:sqlite'

import type { EmailRef } from '../../shared/types'
import { now } from './database'

/** An email the check read, as a change names it. */
export type StoredEmail = { id: number; runId: number | null; companyId: number | null; jobId: number | null; personId: number | null; email: EmailRef }

/**
 * Emails: every email the Gmail check looks at, one row each, so the next
 * check skips it. One about a job or a person you track is matched and
 * linked to them; what it changed is in Activity, pointing back here. The
 * check never creates anything from an email.
 */
export class Emails {
  constructor(private readonly db: DatabaseSync) {}

  /** An email as the check knows it: its thread and the date of its newest message, so a reply counts as new. */
  static keyOf(threadId: string, date: string): string {
    return `${threadId}|${date}`
  }

  isSeen(gmailId: string): boolean {
    return this.db.prepare('SELECT 1 FROM emails WHERE gmail_id = ?').get(gmailId) !== undefined
  }

  /**
   * Marks an email as about a job or a person you track, linking it to them,
   * and returns its row's id for the Activity rows it causes.
   */
  match(entry: { gmailId: string; threadId: string; runId: number | null; ref: EmailRef; companyId: number | null; jobId?: number | null; personId?: number | null }): number {
    this.db
      .prepare(
        `INSERT INTO emails (gmail_id, thread_id, run_id, seen_at, outcome, company_id, job_id, person_id, subject, sender, date, link)
         VALUES (?, ?, ?, ?, 'matched', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (gmail_id) DO UPDATE SET outcome = 'matched',
           company_id = COALESCE(emails.company_id, excluded.company_id),
           job_id = COALESCE(emails.job_id, excluded.job_id),
           person_id = COALESCE(emails.person_id, excluded.person_id),
           subject = excluded.subject, sender = excluded.sender, date = excluded.date, link = excluded.link`,
      )
      .run(entry.gmailId, entry.threadId, entry.runId, now(), entry.companyId, entry.jobId ?? null, entry.personId ?? null, entry.ref.subject, entry.ref.from, entry.ref.date, entry.ref.link)
    return Number((this.db.prepare('SELECT id FROM emails WHERE gmail_id = ?').get(entry.gmailId) as { id: number }).id)
  }

  /** Records every email a check listed as seen; ones it matched keep their links. */
  markSeen(entries: { gmailId: string; threadId: string }[], runId: number | null): void {
    const insert = this.db.prepare(
      "INSERT INTO emails (gmail_id, thread_id, run_id, seen_at, outcome) VALUES (?, ?, ?, ?, 'skipped') ON CONFLICT (gmail_id) DO NOTHING",
    )
    for (const entry of entries) insert.run(entry.gmailId, entry.threadId, runId, now())
  }

  get(id: number): StoredEmail | null {
    const row = this.db
      .prepare('SELECT id, run_id AS runId, company_id AS companyId, job_id AS jobId, person_id AS personId, subject, sender, date, link FROM emails WHERE id = ?')
      .get(id) as (Omit<StoredEmail, 'email'> & { subject: string | null; sender: string | null; date: string | null; link: string | null }) | undefined
    if (!row) return null
    const { subject, sender, date, link, ...rest } = row
    return { ...rest, email: { subject: subject ?? '(no subject)', from: sender ?? '', date: date ?? '', link: link ?? '' } }
  }

  /** How many emails a check looked at, and how many were about something you track. */
  runCounts(runId: number): { listed: number; matched: number } {
    const row = this.db
      .prepare("SELECT COUNT(*) AS listed, COALESCE(SUM(outcome = 'matched'), 0) AS matched FROM emails WHERE run_id = ?")
      .get(runId) as { listed: number; matched: number }
    return { listed: Number(row.listed), matched: Number(row.matched) }
  }
}
