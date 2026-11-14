import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { PORTALS, STAGES, TRACKER_VIEWS, VIEW_STATUSES, WORK_MODES } from '../../shared/types'
import type {
  Company,
  CompanyDetail,
  CompanyEvent,
  CompanyList,
  CompanyQuery,
  CompanyRow,
  Contact,
  ContactState,
  NeverShowCompany,
  TrackerRow,
  TrackerView,
} from '../../shared/types'
import { companyKey, now, today } from './database'

/** The tables whose rows belong to a company, each by `company_id`, with the name kept beside it. */
export type CompanyTable = 'opportunities' | 'contacts' | 'discarded' | 'email_waiting'
const TABLES: CompanyTable[] = ['opportunities', 'contacts', 'discarded', 'email_waiting']

const COMPANY = `id, name, stage, linkedin_url AS linkedinUrl, website, headcount, notes,
  never_show AS neverShow, never_why AS neverWhy, never_since AS neverSince, added`

const JOB = `id, company, role, stage, score, status, last_touch AS lastTouch,
  next_action AS nextAction, portal, job_id AS jobId, link, posting_state AS postingState, work_mode AS workMode, company_id AS companyId`

/** The same columns from a job joined to its company, whose name and stage win. */
const JOINED = `o.id, c.name AS company, o.role, c.stage, o.score, o.status, o.last_touch AS lastTouch,
  o.next_action AS nextAction, o.portal, o.job_id AS jobId, o.link, o.posting_state AS postingState, o.work_mode AS workMode, o.company_id AS companyId`

/** Furthest along wins; a closed job counts only when every job at the company is closed. */
const ORDER = ['found', 'applied', 'outreach', 'replied', 'screen', 'onsite', 'offer']

export function furthest(statuses: string[]): string {
  const open = statuses.filter(status => ORDER.includes(status))
  if (open.length) return open.reduce((best, status) => (ORDER.indexOf(status) > ORDER.indexOf(best) ? status : best))
  return statuses.includes('rejected') ? 'rejected' : (statuses[0] ?? 'found')
}

type CompanyRecord = Omit<Company, 'neverShow'> & { neverShow: number }

const toCompany = (row: CompanyRecord): Company => ({ ...row, neverShow: Boolean(row.neverShow) })

/**
 * Companies: the record every job, contact, discarded posting and email
 * belongs to. Each is found by its name reduced for matching, so
 * "Acme.ai" and "acme ai" are one company, and created the first
 * time a hunt, an application or the user names it.
 */
export class Companies {
  constructor(private readonly db: DatabaseSync) {}

  /** The company with this name, created if it is new. A new company takes `stage`; an existing one keeps its own. */
  resolve(name: string, stage?: string | null): number {
    const clean = name.trim()
    if (!clean) throw new Error('A company needs a name.')
    const key = companyKey(clean)
    const found = this.db.prepare('SELECT id FROM companies WHERE key = ?').get(key) as { id: number } | undefined
    if (found) return Number(found.id)
    const result = this.db
      .prepare('INSERT INTO companies (name, key, stage, notes, never_show, added) VALUES (?, ?, ?, ?, 0, ?)')
      .run(clean, key, stage && (STAGES as readonly string[]).includes(stage) ? stage : 'scaleup', '', today())
    return Number(result.lastInsertRowid)
  }

  /** Ties a row to its company: found or created from the name the row carries. */
  attach(table: CompanyTable, rowId: number, name: string, stage?: string | null): number {
    const companyId = this.resolve(name, stage)
    this.db.prepare(`UPDATE ${table} SET company_id = ? WHERE id = ?`).run(companyId, rowId)
    return companyId
  }

  get(id: number): Company | null {
    const row = this.db.prepare(`SELECT ${COMPANY} FROM companies WHERE id = ?`).get(id) as CompanyRecord | undefined
    return row ? toCompany({ ...row }) : null
  }

  byName(name: string): Company | null {
    const row = this.db.prepare(`SELECT ${COMPANY} FROM companies WHERE key = ?`).get(companyKey(name)) as CompanyRecord | undefined
    return row ? toCompany({ ...row }) : null
  }

  /** Every company name, for pickers. */
  names(): { id: number; name: string }[] {
    return this.db.prepare('SELECT id, name FROM companies ORDER BY name COLLATE NOCASE').all().map(row => ({ ...(row as { id: number; name: string }) }))
  }

  setStage(id: number, stage: string): void {
    if (!(STAGES as readonly string[]).includes(stage)) throw new Error(`${stage} is not a stage`)
    this.db.prepare('UPDATE companies SET stage = ?, updated = ? WHERE id = ?').run(stage, now(), id)
    this.db.prepare('UPDATE opportunities SET stage = ? WHERE company_id = ?').run(stage, id)
  }

  setNotes(id: number, notes: string): void {
    this.db.prepare('UPDATE companies SET notes = ?, updated = ? WHERE id = ?').run(notes, now(), id)
  }

  setLinks(id: number, links: { linkedinUrl?: string | null; website?: string | null; headcount?: string | null }): void {
    const current = this.get(id)
    if (!current) throw new Error(`no company with id ${id}`)
    this.db
      .prepare('UPDATE companies SET linkedin_url = ?, website = ?, headcount = ?, updated = ? WHERE id = ?')
      .run(links.linkedinUrl ?? current.linkedinUrl, links.website ?? current.website, links.headcount ?? current.headcount, now(), id)
  }

  /** Hunts skip every job at a company the user never wants to see; it stays in the tracker. */
  setNeverShow(id: number, on: boolean, why = ''): void {
    this.db
      .prepare('UPDATE companies SET never_show = ?, never_why = ?, never_since = ?, updated = ? WHERE id = ?')
      .run(on ? 1 : 0, on ? why.trim() || 'You asked' : null, on ? today() : null, now(), id)
  }

  /** Renames a company everywhere, so the names its rows carry stay in step. */
  rename(id: number, name: string): void {
    const clean = name.trim()
    if (!clean) throw new Error('A company needs a name.')
    const clash = this.byName(clean)
    if (clash && clash.id !== id) throw new Error(`${clash.name} already exists: merge into it instead.`)
    this.db.prepare('UPDATE companies SET name = ?, key = ?, updated = ? WHERE id = ?').run(clean, companyKey(clean), now(), id)
    for (const table of TABLES) this.db.prepare(`UPDATE ${table} SET company = ? WHERE company_id = ?`).run(clean, id)
  }

  /**
   * Moves everything at one company onto another, then removes the first:
   * for a recruiter's placeholder once the client is known, or two spellings
   * of one name.
   */
  merge(fromId: number, intoId: number): void {
    if (fromId === intoId) return
    const into = this.get(intoId)
    if (!into || !this.get(fromId)) throw new Error('Both companies must exist to merge them.')
    for (const table of TABLES) {
      this.db.prepare(`UPDATE ${table} SET company_id = ?, company = ? WHERE company_id = ?`).run(intoId, into.name, fromId)
    }
    this.db.prepare('DELETE FROM companies WHERE id = ?').run(fromId)
  }

  /** The tracker: one entry per company with jobs in the view, each with those jobs. */
  list(query: CompanyQuery): CompanyList {
    const statuses = VIEW_STATUSES[query.view] ?? null
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (statuses) {
      where.push(`o.status IN (${statuses.map(() => '?').join(', ')})`)
      params.push(...statuses)
    }
    if ((STAGES as readonly string[]).includes(query.stage)) {
      where.push('c.stage = ?')
      params.push(query.stage)
    }
    if ((PORTALS as readonly string[]).includes(query.portal)) {
      where.push('lower(o.portal) = ?')
      params.push(query.portal)
    } else if (query.portal === 'other') {
      where.push(`lower(o.portal) NOT IN (${PORTALS.map(() => '?').join(', ')})`)
      params.push(...PORTALS)
    }
    const modes = query.modes.filter(mode => (WORK_MODES as readonly string[]).includes(mode))
    if (modes.length && modes.length < WORK_MODES.length) {
      where.push(`o.work_mode IN (${modes.map(() => '?').join(', ')})`)
      params.push(...modes)
    }
    const search = query.search.trim().toLowerCase()
    if (search) {
      where.push('(lower(c.name) LIKE ? OR lower(o.role) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const jobs = this.db
      .prepare(
        `SELECT ${JOINED} FROM opportunities o JOIN companies c ON c.id = o.company_id ${clause}
         ORDER BY o.last_touch DESC, o.id DESC`,
      )
      .all(...params)
      .map(row => ({ ...row }) as TrackerRow)

    const byCompany = new Map<number, TrackerRow[]>()
    for (const job of jobs) {
      const list = byCompany.get(job.companyId!) ?? []
      list.push(job)
      byCompany.set(job.companyId!, list)
    }
    const ids = [...byCompany.keys()]
    const companies = new Map(ids.map(id => [id, this.get(id)!]))
    const allJobs = this.jobsOf(ids)
    const referral = this.referralOf(ids)

    const rows: CompanyRow[] = ids.map(id => {
      const own = allJobs.get(id) ?? []
      const company = companies.get(id)!
      return {
        id,
        name: company.name,
        stage: company.stage,
        status: furthest(own.map(job => job.status)),
        bestScore: own.reduce<number | null>((best, job) => (job.score !== null && (best === null || job.score > best) ? job.score : best), null),
        updated: own.reduce((latest, job) => (job.lastTouch > latest ? job.lastTouch : latest), ''),
        jobCount: own.length,
        referral: referral.get(id) ?? { pending: 0, accepted: 0, messaged: 0, referred: 0 },
        neverShow: company.neverShow,
        jobs: byCompany.get(id)!,
      }
    })

    return { companies: rows, counts: this.viewCounts(), totalCompanies: this.count(), totalJobs: this.jobCount() }
  }

  /** How many companies each view holds. */
  viewCounts(): Record<TrackerView, number> {
    const counts = {} as Record<TrackerView, number>
    for (const view of TRACKER_VIEWS) {
      const statuses = VIEW_STATUSES[view]
      const sql = statuses
        ? `SELECT COUNT(DISTINCT company_id) AS n FROM opportunities WHERE status IN (${statuses.map(() => '?').join(', ')})`
        : 'SELECT COUNT(DISTINCT company_id) AS n FROM opportunities'
      counts[view] = Number((this.db.prepare(sql).get(...(statuses ?? [])) as { n: number }).n)
    }
    return counts
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(DISTINCT company_id) AS n FROM opportunities').get() as { n: number }).n)
  }

  jobCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM opportunities').get() as { n: number }).n)
  }

  private jobsOf(ids: number[]): Map<number, TrackerRow[]> {
    const out = new Map<number, TrackerRow[]>()
    if (!ids.length) return out
    const rows = this.db
      .prepare(`SELECT ${JOB} FROM opportunities WHERE company_id IN (${ids.map(() => '?').join(', ')}) ORDER BY last_touch DESC, id DESC`)
      .all(...ids)
      .map(row => ({ ...row }) as TrackerRow)
    for (const row of rows) {
      const list = out.get(row.companyId!) ?? []
      list.push(row)
      out.set(row.companyId!, list)
    }
    return out
  }

  private referralOf(ids: number[]): Map<number, Record<ContactState, number>> {
    const out = new Map<number, Record<ContactState, number>>()
    if (!ids.length) return out
    for (const row of this.db
      .prepare(`SELECT company_id AS companyId, state, COUNT(*) AS n FROM contacts WHERE company_id IN (${ids.map(() => '?').join(', ')}) GROUP BY company_id, state`)
      .all(...ids)) {
      const { companyId, state, n } = row as { companyId: number; state: ContactState; n: number }
      const counts = out.get(companyId) ?? { pending: 0, accepted: 0, messaged: 0, referred: 0 }
      counts[state] = Number(n)
      out.set(companyId, counts)
    }
    return out
  }

  /** One company's page: its jobs, its people and everything that happened at it. */
  detail(id: number): CompanyDetail | null {
    const company = this.get(id)
    if (!company) return null
    const jobs = this.jobsOf([id]).get(id) ?? []
    const contacts = this.db
      .prepare(
        `SELECT id, name, role, company, profile_url AS profileUrl, sent, state, accepted_at AS acceptedAt,
           messaged_at AS messagedAt, referred_at AS referredAt
         FROM contacts WHERE company_id = ?
         ORDER BY CASE state WHEN 'referred' THEN 0 WHEN 'accepted' THEN 1 WHEN 'messaged' THEN 2 ELSE 3 END, sent DESC`,
      )
      .all(id)
      .map(row => ({ ...row }) as Contact)

    const events: CompanyEvent[] = []
    if (jobs.length) {
      for (const row of this.db
        .prepare(
          `SELECT e.id, e.at, e.text, e.run_id AS runId, o.id AS jobId, o.role
           FROM opportunity_events e JOIN opportunities o ON o.id = e.opportunity_id
           WHERE o.company_id = ? ORDER BY e.at DESC, e.id DESC LIMIT 60`,
        )
        .all(id)) {
        const event = row as { id: number; at: string; text: string; runId: number | null; jobId: number; role: string }
        events.push({ key: `job-${event.id}`, at: event.at, kind: 'job', text: `${event.role}: ${event.text}`, jobId: event.jobId, runId: event.runId })
      }
    }
    const sent = contacts.filter(contact => contact.sent)
    if (sent.length) {
      const byDay = new Map<string, number>()
      for (const contact of sent) byDay.set(contact.sent, (byDay.get(contact.sent) ?? 0) + 1)
      for (const [day, n] of byDay) events.push({ key: `sent-${day}`, at: day, kind: 'contact', text: `${n} connection ${n === 1 ? 'request' : 'requests'} sent`, jobId: null, runId: null })
    }
    for (const contact of contacts) {
      if (contact.acceptedAt) events.push({ key: `acc-${contact.id}`, at: contact.acceptedAt, kind: 'contact', text: `${contact.name} accepted`, jobId: null, runId: null })
      if (contact.messagedAt) events.push({ key: `msg-${contact.id}`, at: contact.messagedAt, kind: 'contact', text: `Referral message sent to ${contact.name}`, jobId: null, runId: null })
      if (contact.referredAt) events.push({ key: `ref-${contact.id}`, at: contact.referredAt, kind: 'contact', text: `${contact.name} referred you`, jobId: null, runId: null })
    }
    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

    return { company, jobs, contacts, events: events.slice(0, 80) }
  }

  /** Companies hunts never show, as the Discarded screen lists them. */
  neverShown(): NeverShowCompany[] {
    return this.db
      .prepare("SELECT id, name AS company, COALESCE(never_why, '') AS why, COALESCE(never_since, added) AS added FROM companies WHERE never_show = 1 ORDER BY name COLLATE NOCASE")
      .all()
      .map(row => ({ ...row }) as NeverShowCompany)
  }
}

/**
 * Companies hunts never show again, whatever they post: a flag on the
 * company, so the company and its history stay in the tracker.
 */
export class NeverShow {
  constructor(private readonly companies: Companies) {}

  list(): NeverShowCompany[] {
    return this.companies.neverShown()
  }

  add(company: string, why: string): number {
    if (!company.trim()) throw new Error('Enter a company name.')
    const id = this.companies.resolve(company)
    this.companies.setNeverShow(id, true, why)
    return id
  }

  /** Shows a company in hunts again; `id` is the company's. */
  remove(id: number): void {
    this.companies.setNeverShow(id, false)
  }

  match(company: string): NeverShowCompany | null {
    const found = this.companies.byName(company)
    return found?.neverShow ? { id: found.id, company: found.name, why: found.neverWhy ?? '', added: found.neverSince ?? found.added } : null
  }

  count(): number {
    return this.companies.neverShown().length
  }
}

