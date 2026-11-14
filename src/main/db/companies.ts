import type { DatabaseSync } from 'node:sqlite'

import { STAGES } from '../../shared/types'
import type { Company, NeverShowCompany, Status } from '../../shared/types'
import { companyKey, now, today } from './database'

/** The tables whose rows point at a company by `company_id`. Names live on companies only. */
const TABLES = ['jobs', 'emails', 'activity'] as const

const COMPANY = `id, name, stage, linkedin_url AS linkedinUrl, website, headcount, notes,
  never_show AS neverShow, never_why AS neverWhy, never_since AS neverSince, added`

/** Furthest along wins; a closed job counts only when every open one is gone, and discarded only when nothing else is left. */
const ORDER: Status[] = ['found', 'applied', 'outreached', 'referred', 'interview', 'offer']

export function furthest(statuses: Status[]): Status {
  const open = statuses.filter(status => ORDER.includes(status))
  if (open.length) return open.reduce((best, status) => (ORDER.indexOf(status) > ORDER.indexOf(best) ? status : best))
  if (statuses.includes('rejected')) return 'rejected'
  if (statuses.includes('dead')) return 'dead'
  return statuses[0] ?? 'found'
}

type CompanyRecord = Omit<Company, 'neverShow'> & { neverShow: number }

const toCompany = (row: CompanyRecord): Company => ({ ...row, neverShow: Boolean(row.neverShow) })

/**
 * Companies: the record every job, person and email belongs to, and the only
 * place a company's name and details live. Each is found by its name reduced for matching, so
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

  /** Renames a company; everything that belongs to it shows the new name, since names live here only. */
  rename(id: number, name: string): void {
    const clean = name.trim()
    if (!clean) throw new Error('A company needs a name.')
    const clash = this.byName(clean)
    if (clash && clash.id !== id) throw new Error(`${clash.name} already exists: merge into it instead.`)
    this.db.prepare('UPDATE companies SET name = ?, key = ?, updated = ? WHERE id = ?').run(clean, companyKey(clean), now(), id)
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
    for (const table of TABLES) this.db.prepare(`UPDATE ${table} SET company_id = ? WHERE company_id = ?`).run(intoId, fromId)
    // Someone with a position at both keeps the one at the company merged into.
    this.db.prepare('UPDATE OR IGNORE positions SET company_id = ? WHERE company_id = ?').run(intoId, fromId)
    this.db.prepare('DELETE FROM positions WHERE company_id = ?').run(fromId)
    this.db.prepare('DELETE FROM companies WHERE id = ?').run(fromId)
  }

    /** Companies with at least one job that isn't discarded: the tracker's count. */
  count(): number {
    return Number((this.db.prepare("SELECT COUNT(DISTINCT company_id) AS n FROM jobs WHERE status != 'discarded'").get() as { n: number }).n)
  }

  /** Companies hunts never show, as the Never show screen lists them. */
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

