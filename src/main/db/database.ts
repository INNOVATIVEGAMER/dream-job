import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { workModeOf } from '../../shared/types'

/** Today as YYYY-MM-DD in local time, the form the tracker's date columns use. */
export function today(at = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/** Now as an ISO timestamp, for events and runs. */
export const now = (): string => new Date().toISOString()

/** A company name reduced for matching: "Acme.io" and "acme io" are the same company. */
export function companyKey(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

type Migration = (db: DatabaseSync) => void

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => String((row as { name: string }).name)))
}

function addColumns(db: DatabaseSync, table: string, wanted: Record<string, string>): void {
  const have = columns(db, table)
  for (const [name, type] of Object.entries(wanted)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
  }
}

/**
 * Each migration runs once, in order; `PRAGMA user_version` records how many
 * have run. The first one also accepts the table the POC created, which
 * already holds the 96 kept rows.
 */
const MIGRATIONS: Migration[] = [
  db => {
    db.exec(`CREATE TABLE IF NOT EXISTS opportunities (
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
      updated_at TEXT
    )`)
    addColumns(db, 'opportunities', {
      link: 'TEXT',
      posting_state: 'TEXT',
      posting_checked: 'TEXT',
      posting_note: 'TEXT',
      pay: 'TEXT',
      experience: 'TEXT',
      apply_route: 'TEXT',
      score_reasons: 'TEXT',
      run_id: 'INTEGER',
    })
    db.exec(`
      CREATE INDEX IF NOT EXISTS opportunities_status ON opportunities (status);
      CREATE INDEX IF NOT EXISTS opportunities_job ON opportunities (portal, job_id);

      CREATE TABLE IF NOT EXISTS opportunity_events (
        id INTEGER PRIMARY KEY,
        opportunity_id INTEGER NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        text TEXT NOT NULL,
        run_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS opportunity_events_row ON opportunity_events (opportunity_id);

      CREATE TABLE IF NOT EXISTS discarded (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        portal TEXT NOT NULL,
        job_id TEXT NOT NULL,
        link TEXT,
        line TEXT NOT NULL,
        reason TEXT NOT NULL,
        run_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS discarded_job ON discarded (portal, job_id);

      CREATE TABLE IF NOT EXISTS never_show (
        id INTEGER PRIMARY KEY,
        company TEXT NOT NULL,
        company_key TEXT NOT NULL UNIQUE,
        why TEXT NOT NULL,
        added TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        company TEXT NOT NULL,
        profile_url TEXT NOT NULL UNIQUE,
        sent TEXT NOT NULL,
        state TEXT NOT NULL,
        accepted_at TEXT,
        messaged_at TEXT,
        referred_at TEXT,
        run_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS contacts_company ON contacts (company);

      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        flow TEXT NOT NULL,
        title TEXT NOT NULL,
        portal TEXT,
        opportunity_id INTEGER,
        started TEXT NOT NULL,
        ended TEXT,
        status TEXT NOT NULL,
        result TEXT,
        turns INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        ms INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS run_events (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_events_run ON run_events (run_id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS answers (
        id INTEGER PRIMARY KEY,
        question TEXT NOT NULL,
        question_key TEXT NOT NULL UNIQUE,
        answer TEXT NOT NULL,
        updated TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sites (
        site TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        checked TEXT
      );
    `)
  },
  db => {
    addColumns(db, 'contacts', { thanked_at: 'TEXT' })
  },
  db => {
    // The kind of role skipped is the user's own setting, not one fixed kind.
    db.exec("UPDATE discarded SET reason = 'skipped-role' WHERE reason = 'backend-only'")
  },
  db => {
    // The email check: what it has read, what it changed, and jobs it found that the tracker lacks.
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_seen (
        key TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        run_id INTEGER,
        seen_at TEXT NOT NULL,
        opened INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS email_seen_run ON email_seen (run_id);

      CREATE TABLE IF NOT EXISTS email_changes (
        id INTEGER PRIMARY KEY,
        run_id INTEGER,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        note TEXT NOT NULL,
        email_subject TEXT NOT NULL,
        email_from TEXT NOT NULL,
        email_date TEXT NOT NULL,
        email_link TEXT NOT NULL,
        undone_at TEXT
      );
      CREATE INDEX IF NOT EXISTS email_changes_run ON email_changes (run_id);

      CREATE TABLE IF NOT EXISTS email_waiting (
        id INTEGER PRIMARY KEY,
        run_id INTEGER,
        at TEXT NOT NULL,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        summary TEXT NOT NULL,
        email_subject TEXT NOT NULL,
        email_from TEXT NOT NULL,
        email_date TEXT NOT NULL,
        email_link TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'waiting',
        row_id INTEGER
      );
    `)
  },
  db => {
    // Companies as records of their own: every job, contact, discarded posting
    // and email belongs to one, by id, with the name kept beside it.
    db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        stage TEXT NOT NULL DEFAULT 'scaleup',
        linkedin_url TEXT,
        website TEXT,
        headcount TEXT,
        notes TEXT NOT NULL DEFAULT '',
        never_show INTEGER NOT NULL DEFAULT 0,
        never_why TEXT,
        never_since TEXT,
        added TEXT NOT NULL,
        updated TEXT
      );
    `)
    const tables = ['opportunities', 'contacts', 'discarded', 'email_waiting'] as const
    for (const table of tables) {
      addColumns(db, table, { company_id: 'INTEGER' })
      db.exec(`CREATE INDEX IF NOT EXISTS ${table}_company ON ${table} (company_id)`)
    }

    // One company per name already recorded: the newest spelling, and the stage of its newest job.
    type Seed = { name: string; stage: string; added: string }
    const seeds = new Map<string, Seed>()
    const plant = (name: string, stage: string, added: string): void => {
      const key = companyKey(name)
      if (key && !seeds.has(key)) seeds.set(key, { name: name.trim(), stage, added })
    }
    for (const row of db.prepare('SELECT company, stage, found FROM opportunities ORDER BY last_touch DESC, id DESC').all()) {
      const { company, stage, found } = row as { company: string; stage: string; found: string }
      plant(company, stage, found)
    }
    for (const row of db.prepare('SELECT company, sent AS added FROM contacts ORDER BY sent DESC').all()) {
      const { company, added } = row as { company: string; added: string }
      plant(company, 'scaleup', added)
    }
    for (const table of ['discarded', 'email_waiting'] as const) {
      for (const row of db.prepare(`SELECT company, substr(at, 1, 10) AS added FROM ${table} ORDER BY at DESC`).all()) {
        const { company, added } = row as { company: string; added: string }
        plant(company, 'scaleup', added)
      }
    }
    for (const row of db.prepare('SELECT company, added FROM never_show').all()) {
      const { company, added } = row as { company: string; added: string }
      plant(company, 'scaleup', added)
    }
    const insert = db.prepare("INSERT INTO companies (name, key, stage, notes, added) VALUES (?, ?, ?, '', ?)")
    for (const [key, seed] of seeds) insert.run(seed.name, key, seed.stage || 'scaleup', seed.added || today())

    for (const row of db.prepare('SELECT company_key, why, added FROM never_show').all()) {
      const { company_key: key, why, added } = row as { company_key: string; why: string; added: string }
      db.prepare('UPDATE companies SET never_show = 1, never_why = ?, never_since = ? WHERE key = ?').run(why, added, key)
    }

    const ids = new Map<string, number>()
    for (const row of db.prepare('SELECT id, key FROM companies').all()) {
      const { id, key } = row as { id: number; key: string }
      ids.set(key, Number(id))
    }
    for (const table of tables) {
      const link = db.prepare(`UPDATE ${table} SET company_id = ? WHERE id = ?`)
      for (const row of db.prepare(`SELECT id, company FROM ${table}`).all()) {
        const { id, company } = row as { id: number; company: string }
        const companyId = ids.get(companyKey(company))
        if (companyId) link.run(companyId, id)
      }
    }
  },

  // Each job's work mode as a fixed label, read from the mode text it already has.
  db => {
    addColumns(db, 'opportunities', { work_mode: "TEXT NOT NULL DEFAULT 'not-stated'" })
    const set = db.prepare('UPDATE opportunities SET work_mode = ? WHERE id = ?')
    for (const row of db.prepare('SELECT id, mode FROM opportunities').all()) {
      const { id, mode } = row as { id: number; mode: string | null }
      set.run(workModeOf(mode ?? ''), id)
    }
    db.exec('CREATE INDEX IF NOT EXISTS opportunities_work_mode ON opportunities (work_mode)')
  },

  // Two links per job: where it was found on a portal, and where the application goes (`link`).
  // Until now `link` held the portal's, so a portal link moves across as both.
  db => {
    addColumns(db, 'opportunities', { portal_link: 'TEXT' })
    db.exec(`UPDATE opportunities SET portal_link = link
      WHERE link LIKE '%linkedin.com/%' OR link LIKE '%wellfound.com/%' OR link LIKE '%angel.co/%' OR link LIKE '%instahyre.com/%'`)
  },

  // The fewest years of experience a job asks for, as Claude reads it from the posting. Empty until read.
  db => {
    addColumns(db, 'opportunities', { min_years: 'INTEGER' })
  },

  // The posting link for older LinkedIn and Instahyre jobs, built from the job id in each portal's own
  // address format. Sources without a known format stay empty, for the user to paste.
  db => {
    db.exec(`UPDATE opportunities SET portal_link = 'https://www.linkedin.com/jobs/view/' || job_id || '/'
      WHERE portal_link IS NULL AND lower(portal) = 'linkedin' AND job_id GLOB '[0-9]*' AND job_id NOT GLOB '*[^0-9]*'`)
    db.exec(`UPDATE opportunities SET portal_link = 'https://www.instahyre.com/job-' || job_id || '/'
      WHERE portal_link IS NULL AND lower(portal) = 'instahyre' AND job_id GLOB '[0-9]*' AND job_id NOT GLOB '*[^0-9]*'`)
  },

  // A person is a request sent or a connection. Messaged and referred were connections:
  // they stay connected, and their dates stay as history.
  db => {
    db.exec(`UPDATE contacts SET state = 'accepted', accepted_at = COALESCE(accepted_at, messaged_at, referred_at, sent)
      WHERE state IN ('messaged', 'referred')`)
  },
]

export const SCHEMA_VERSION = MIGRATIONS.length

/**
 * Opens the app's database and brings it up to date. Only the main process
 * opens it, through Node's built-in SQLite.
 */
export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      MIGRATIONS[i]!(db)
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return db
}

/** A question reduced for matching, so "Notice period?" finds "notice period". */
export function questionKey(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Page arithmetic shared by every paged list. */
export function paging(total: number, page: number, pageSize: number): { at: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const at = Math.min(Math.max(0, Math.trunc(page) || 0), pages - 1)
  return { at, pages }
}
