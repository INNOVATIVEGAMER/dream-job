import { z } from 'zod'

import { HUNT_WINDOWS, PORTALS, SOURCES, STAGES, STATUSES, TRACKER_VIEWS, WORK_MODES } from '../shared/types'

/**
 * The checks every input from outside the main process passes: the screens'
 * requests, and the chat's tool calls. One definition each, so Claude can put
 * nothing in the tracker a screen could not.
 */

export const id = z.number().int().positive()
export const page = z.number().int().min(0).max(100_000)
export const short = (max = 200) => z.string().max(max)

export const CompanyQuery = z.object({ view: z.enum(TRACKER_VIEWS), stage: short(), portal: short(), search: short(), modes: z.array(z.enum(WORK_MODES)).max(WORK_MODES.length).default([]) })
export const RunQuery = z.object({ flow: short(), portal: short(), page })
export const httpsLink = z.string().trim().url('Enter the link to the posting or the apply page.').max(2000).refine(url => /^https?:\/\//i.test(url), 'Use an https link.')
const linkOrEmpty = z.union([z.literal(''), httpsLink])
export const JobEdit = z.discriminatedUnion('field', [
  z.object({ field: z.literal('role'), value: z.string().trim().min(1, "The role can't be empty.").max(200) }),
  z.object({ field: z.literal('company'), value: z.string().trim().min(1, 'Pick a company, or type a new one.').max(200) }),
  z.object({ field: z.literal('reqId'), value: short(60) }),
  z.object({ field: z.literal('minYears'), value: z.number().int().min(0).max(40).nullable() }),
  z.object({ field: z.literal('score'), value: z.number().int().min(1).max(10).nullable() }),
  z.object({ field: z.literal('portal'), value: z.enum(SOURCES) }),
  z.object({ field: z.literal('postingLink'), value: linkOrEmpty }),
  z.object({ field: z.literal('applyLink'), value: linkOrEmpty }),
  z.object({ field: z.literal('pay'), value: short(200) }),
  z.object({ field: z.literal('found'), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.') }),
])
export const CompanyEdit = z.object({ field: z.enum(['name', 'headcount', 'linkedinUrl', 'website']), value: short(2000) })
export const NewJob = z.object({
  company: z.string().trim().min(1, 'Enter the company.').max(200),
  stage: z.enum(STAGES),
  role: z.string().trim().min(1, 'Enter the role.').max(200),
  link: httpsLink,
  reqId: short(60).default(''),
  status: z.enum(STATUSES).refine(status => status !== 'discarded', 'A new job starts at found or later.'),
  portal: z.enum(SOURCES),
  workMode: z.enum(WORK_MODES).optional(),
  notes: short(10_000),
})
export const CardAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approve'), texts: z.array(z.string().max(20_000)).max(20) }),
  z.object({ kind: z.literal('cancel') }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('choose'), option: short() }),
  z.object({ kind: z.literal('answer'), texts: z.array(z.string().max(2000)).max(20), save: z.boolean() }),
])
export const HuntOptions = z.object({ portals: z.array(z.enum(PORTALS)).min(1, 'Pick at least one portal.'), window: z.enum(HUNT_WINDOWS) })
// No cap on how many: each run splits the work into sessions and works through them a few at a time.
export const ConnectOptions = z.object({ companyIds: z.array(id).min(1, 'Pick at least one company.'), perCompany: z.number().int().min(1).max(30) })
export const ReferralOptions = z.object({ jobId: id, personIds: z.array(id).min(1, 'Pick at least one person.'), resume: z.boolean() })
