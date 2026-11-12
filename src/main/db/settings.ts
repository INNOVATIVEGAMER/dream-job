import type { DatabaseSync } from 'node:sqlite'

import { z } from 'zod'

import { CURRENCIES, HUNT_WINDOWS, PAY_PERIODS, PORTAL_TOOLS, PORTALS } from '../../shared/types'
import type {
  FormAnswer,
  PortalSettings,
  Preferences,
  Profile,
  ReferralMessage,
  ResumeInfo,
  Settings as SettingsValue,
  SiteState,
} from '../../shared/types'
import { now, questionKey, today } from './database'

const text = (max: number) => z.string().trim().max(max)
const list = (max: number, each: number) => z.array(z.string().trim().min(1).max(each)).max(max)

export const PreferencesSchema = z.object({
  targetRoles: list(20, 120),
  skipRoles: list(20, 120),
  ceilingYears: z.number().int().min(0).max(60).nullable(),
  window: z.enum(HUNT_WINDOWS),
  country: text(80),
  cities: list(10, 80),
  modes: z.object({ remote: z.boolean(), hybrid: z.boolean(), onsite: z.boolean() }),
  needsVisa: z.boolean(),
  currency: z.enum(CURRENCIES),
  floor: z.number().positive().max(100_000_000).nullable(),
  period: z.enum(PAY_PERIODS),
})

const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM.').or(z.literal(''))

export const RoleSchema = z.object({
  id: z.string().min(1).max(64),
  title: text(120),
  company: text(120),
  start: month,
  end: month.nullable(),
  isCurrent: z.boolean(),
  built: z.string().max(8_000),
  skills: list(40, 60),
})

export const ProjectSchema = z.object({
  id: z.string().min(1).max(64),
  name: text(120),
  link: text(500),
  about: z.string().max(4_000),
})

export const ProfileSchema = z.object({
  name: text(120),
  headline: text(200),
  location: text(120),
  roles: z.array(RoleSchema).max(30),
  projects: z.array(ProjectSchema).max(30),
  skills: list(100, 60),
  links: z.object({
    linkedin: text(500),
    github: text(500),
    site: text(500),
    other: z.array(z.object({ name: text(60), url: text(500) })).max(10),
  }),
  never: z.string().max(4_000),
})

/** The four slots the approved message may hold. Anything else in braces is refused. */
export const SLOTS = ['{name}', '{role}', '{company}', '{job link}'] as const

export const ReferralSchema = z.object({
  template: z
    .string()
    .max(4_000)
    .refine(value => (value.match(/\{[^}]*\}/g) ?? []).every(slot => (SLOTS as readonly string[]).includes(slot)), {
      message: 'The message may only use the slots {name}, {role}, {company} and {job link}.',
    }),
  attachResume: z.boolean(),
})

const PortalSettingSchema = z.object({
  enabled: z.boolean(),
  tools: z.record(z.string(), z.boolean()),
  freeBrowsing: z.boolean(),
})

export const PortalSettingsSchema = z.object({
  linkedin: PortalSettingSchema,
  wellfound: PortalSettingSchema,
  instahyre: PortalSettingSchema,
})

export const DEFAULT_PREFERENCES: Preferences = {
  targetRoles: [],
  skipRoles: [],
  ceilingYears: null,
  window: 'day',
  country: '',
  cities: [],
  modes: { remote: true, hybrid: true, onsite: true },
  needsVisa: false,
  currency: 'USD',
  floor: null,
  period: 'year',
}

export const DEFAULT_PROFILE: Profile = {
  name: '',
  headline: '',
  location: '',
  roles: [],
  projects: [],
  skills: [],
  links: { linkedin: '', github: '', site: '', other: [] },
  never: '',
}

export const DEFAULT_REFERRAL: ReferralMessage = { template: '', attachResume: true }

/** Every portal on, every tool on: what a new user starts with. */
export const DEFAULT_PORTALS = Object.fromEntries(
  PORTALS.map(portal => [
    portal,
    { enabled: true, tools: Object.fromEntries(PORTAL_TOOLS[portal].map(tool => [tool.name, true])), freeBrowsing: true },
  ]),
) as PortalSettings

/**
 * Fills the approved message for one person. The words are the user's; only
 * the four slots change. Throws when a slot has no value, so a message never
 * goes out with a gap in it.
 */
export function fillTemplate(template: string, values: { name: string; role: string; company: string; jobLink: string }): string {
  const filled: Record<string, string> = {
    '{name}': values.name.trim(),
    '{role}': values.role.trim(),
    '{company}': values.company.trim(),
    '{job link}': values.jobLink.trim(),
  }
  for (const [slot, value] of Object.entries(filled)) {
    if (template.includes(slot) && !value) throw new Error(`The message needs ${slot}, and there is none for this person.`)
  }
  return template.replace(/\{name\}|\{role\}|\{company\}|\{job link\}/g, slot => filled[slot] ?? slot)
}

/** The user's settings, form answers and site sign-ins. */
export class SettingsStore {
  constructor(private readonly db: DatabaseSync) {}

  private read<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return fallback
    try {
      const parsed = schema.safeParse(JSON.parse(row.value))
      return parsed.success ? parsed.data : fallback
    } catch {
      return fallback
    }
  }

  private write(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }

  all(): SettingsValue {
    return {
      preferences: this.preferences(),
      profile: this.profile(),
      referral: this.referral(),
      resume: this.resume(),
      portals: this.portals(),
      isSetUp: this.isSetUp(),
    }
  }

  preferences(): Preferences {
    return this.read('preferences.v2', PreferencesSchema, DEFAULT_PREFERENCES)
  }

  setPreferences(value: unknown): Preferences {
    const parsed = PreferencesSchema.parse(value)
    this.write('preferences.v2', parsed)
    return parsed
  }

  profile(): Profile {
    return this.read('profile.v2', ProfileSchema, DEFAULT_PROFILE)
  }

  setProfile(value: unknown): Profile {
    const parsed = ProfileSchema.parse(value)
    this.write('profile.v2', parsed)
    return parsed
  }

  referral(): ReferralMessage {
    return this.read('referral.v2', ReferralSchema, DEFAULT_REFERRAL)
  }

  setReferral(value: unknown): ReferralMessage {
    const parsed = ReferralSchema.parse(value)
    this.write('referral.v2', parsed)
    return parsed
  }

  /** Portal settings, with any tool a newer release added switched on. */
  portals(): PortalSettings {
    const stored = this.read('portals', PortalSettingsSchema, DEFAULT_PORTALS)
    const merged = { ...DEFAULT_PORTALS }
    for (const portal of PORTALS) {
      merged[portal] = {
        ...stored[portal],
        tools: { ...DEFAULT_PORTALS[portal].tools, ...stored[portal].tools },
      }
    }
    return merged
  }

  setPortals(value: unknown): PortalSettings {
    const parsed = PortalSettingsSchema.parse(value)
    this.write('portals', parsed)
    return this.portals()
  }

  isSetUp(): boolean {
    return this.read('setup.done', z.boolean(), false)
  }

  setSetUp(done: boolean): void {
    this.write('setup.done', done)
  }

  resume(): ResumeInfo | null {
    return this.read(
      'resume',
      z.object({ fileName: z.string(), addedAt: z.string(), pages: z.number().nullable(), bytes: z.number() }).nullable(),
      null,
    )
  }

  setResume(value: ResumeInfo | null): void {
    this.write('resume', value)
  }

  answers(): FormAnswer[] {
    return this.db
      .prepare('SELECT id, question, answer, updated FROM answers ORDER BY question COLLATE NOCASE')
      .all()
      .map(row => ({ ...row }) as FormAnswer)
  }

  /** Saves an answer, replacing one to the same question. */
  saveAnswer(question: string, answer: string): FormAnswer {
    const asked = question.trim()
    if (!asked) throw new Error('Enter the question.')
    if (!answer.trim()) throw new Error('Enter the answer.')
    this.db
      .prepare(
        `INSERT INTO answers (question, question_key, answer, updated) VALUES (?, ?, ?, ?)
         ON CONFLICT (question_key) DO UPDATE SET question = excluded.question, answer = excluded.answer, updated = excluded.updated`,
      )
      .run(asked, questionKey(asked), answer.trim(), today())
    return { ...(this.db.prepare('SELECT id, question, answer, updated FROM answers WHERE question_key = ?').get(questionKey(asked)) as FormAnswer) }
  }

  removeAnswer(id: number): void {
    this.db.prepare('DELETE FROM answers WHERE id = ?').run(id)
  }

  sites(): SiteState[] {
    const known = new Map(
      this.db
        .prepare('SELECT site, state, checked FROM sites')
        .all()
        .map(row => [String((row as SiteState).site), { ...row } as SiteState]),
    )
    return ['google', ...PORTALS].map(site => known.get(site) ?? { site, state: 'unknown', checked: null })
  }

  setSite(site: string, state: SiteState['state']): void {
    this.db
      .prepare('INSERT INTO sites (site, state, checked) VALUES (?, ?, ?) ON CONFLICT (site) DO UPDATE SET state = excluded.state, checked = excluded.checked')
      .run(site, state, now())
  }
}
