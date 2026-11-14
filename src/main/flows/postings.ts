import { z } from 'zod'

import { cleanLink, isPortalLink, linkKey } from '../../shared/links'
import { AT_ONCE, PORTALS, WORK_MODES } from '../../shared/types'
import type { Opportunity, Portal } from '../../shared/types'
import { browserTools, guarded, refuse, REFUSE, say } from '../browser/tools'
import type { Store } from '../db/store'
import { huntTools } from '../portals'
import { defineTool, onePlan } from '../runs/engine'
import type { AnyTool, FlowSpec, RunContext, RunPlan } from '../runs/engine'
import { applyPages, applyPageTool } from './apply-page'
import type { ApplyPages } from './apply-page'

/** Jobs per session: enough to be worth a session, few enough to finish well inside its turns. */
const BATCH = 8

const Output = z.object({ summary: z.string().describe('One line: what these jobs came to') })

type Tally = { checked: number; closed: number; linked: number; unreadable: number }

function portalOf(row: Opportunity): Portal | null {
  const key = row.portal.toLowerCase()
  return (PORTALS as readonly string[]).includes(key) ? (key as Portal) : null
}

/** A job the check can read: on a portal by its id, or by a link. */
export function isCheckable(row: Opportunity): boolean {
  const portal = portalOf(row)
  return row.status === 'found' && (!!row.link || ((portal === 'linkedin' || portal === 'instahyre') && !!row.jobId))
}

/** The portal postings a session really opened, as `<portal>:<job id>` or `link:<link key>`. */
type Opened = Set<string>

/**
 * A portal's read_job that notes each posting it opened: the check saves a
 * job only from a page that really opened in this session, so a portal that
 * refuses pages can't turn into a job marked closed, open or unreadable.
 */
function noting(tool: AnyTool, portal: Portal, opened: Opened): AnyTool {
  return {
    ...tool,
    handler: async (args: Record<string, unknown>, extra: unknown) => {
      const result = await tool.handler(args, extra)
      if (!result.isError) {
        if (typeof args['job_id'] === 'string') opened.add(`${portal}:${args['job_id']}`)
        if (typeof args['link'] === 'string') opened.add(`link:${linkKey(args['link'])}`)
      }
      return result
    },
  }
}

/** Whether this session opened the job's posting on its portal. */
function portalOpened(row: Opportunity, opened: Opened): boolean {
  const portal = portalOf(row)
  if (portal && row.jobId && opened.has(`${portal}:${row.jobId}`)) return true
  return [row.portalLink, row.link].some(link => !!link && opened.has(`link:${linkKey(link)}`))
}

function rowLine(row: Opportunity): string {
  const portal = portalOf(row)
  const read =
    portal === 'linkedin' || portal === 'instahyre'
      ? `${portal}_read_job, job id ${row.jobId}`
      : portal === 'wellfound'
        ? `wellfound_read_job, link ${row.portalLink ?? row.link}`
        : `read_apply_page, link ${row.link}`
  const saved = row.link && !isPortalLink(row.link) ? `; apply page saved: ${row.link}` : ''
  return `- Job ${row.id}: ${row.company}, ${row.role} (${read}${saved}). Recorded: ${row.mode || 'place not recorded'}; ${row.experience ?? 'years not recorded'}; pay ${row.pay ?? 'not recorded'}`
}

function system(rows: Opportunity[]): string {
  return [
    'This session checks jobs already in the tracker, waiting to be applied to, against where their application goes. Nothing is applied to, clicked or sent.',
    '',
    'For each job below, in order:',
    "1. Read it where it was found, with the portal's read_job. A job from elsewhere goes straight to step 2 with its link.",
    "2. When applying leaves the portal, or the job already has an apply page saved, read_apply_page that link. It is the final word on the job.",
    '3. record_check the job.',
    '',
    '- Closed, expired, filled, no longer accepting applications, or not found, on either page: state "closed", quoting the words that say so.',
    '- A sign-in wall, a bot check, or a page that does not show this job: apply_page "unreadable", and say what you saw in notes. The job stays.',
    '- Where the apply page differs from what was recorded (place, work mode, years asked, pay), give its place and mode in mode and work_mode, and the rest in notes. Never drop a job for these: the user decides.',
    '- A job whose portal page will not open (signed out, read_job turned off, or the portal limiting how fast pages open): leave it unrecorded, so it stays as it was for the next check, and name it in your summary. "unreadable" is only for an apply page you opened.',
    '',
    'The jobs:',
    ...rows.map(rowLine),
    '',
    'Finish when every job is recorded or left for one of those reasons.',
  ].join('\n')
}

function recordTool(ctx: RunContext, store: Store, rows: Opportunity[], pages: ApplyPages, opened: Opened, done: Set<number>, bump: (key: keyof Tally) => void): AnyTool {
  return defineTool(
    'record_check',
    'Save what you found for one job. A closed job is marked dead, with the words that say so in its notes.',
    {
      job: z.number().int().describe('The job number from the list'),
      state: z.enum(['open', 'closed']),
      line: z.string().max(500).describe('Closed: the page\'s words that say so, exactly. Open: ""'),
      apply_page: z
        .enum(['read', 'unreadable', 'on-portal'])
        .describe('read: you read it with read_apply_page; unreadable: it could not be read; on-portal: the job applies on the portal'),
      apply_link: z.string().max(2000).describe('Where the application goes: the URL read_apply_page landed on, or the apply link read_job gave when unreadable. "" when it applies on the portal'),
      mode: z.string().max(120).describe('Work mode and place as the final page gives them, such as "Hybrid, Bengaluru", or "" to keep what was recorded'),
      work_mode: z.enum(WORK_MODES).nullable().describe('As the final page states it, or null to keep what was recorded'),
      notes: z.string().max(1000).describe('What differs from what was recorded, or what an unreadable page showed. "" when nothing'),
    },
    input =>
      guarded(async () => {
        const row = rows.find(one => one.id === input.job)
        if (!row) return refuse(`Job ${input.job} is not in this session's list.`)
        if (done.has(row.id)) return say('Already recorded.')
        const line = input.line.trim()
        if (input.state === 'closed' && line.length < 3) return refuse('Quote the words that say it is closed.')
        const link = /^https?:\/\//i.test(input.apply_link.trim()) && !isPortalLink(input.apply_link) ? cleanLink(input.apply_link) : null

        // Every record rests on a page this session opened: a portal that refused gives nothing to record.
        const savedApply = row.link && !isPortalLink(row.link) ? linkKey(row.link) : null
        const readPortal = portalOpened(row, opened)
        const readApply = (!!link && pages.read.has(linkKey(link))) || (!!savedApply && pages.read.has(savedApply))
        if (input.apply_page === 'read' && (!link || !pages.read.has(linkKey(link)))) {
          return refuse('apply_link must be the page you read with read_apply_page. Read it first, or say "unreadable".')
        }
        if (input.apply_page === 'unreadable' && (!link || !pages.tried.has(linkKey(link)))) {
          return refuse(
            'Only an apply page you tried with read_apply_page can be unreadable, with that link as apply_link. A job whose portal page did not open, or that has no apply link, stays unrecorded: leave it.',
          )
        }
        if (input.apply_page === 'on-portal' && !readPortal) {
          return refuse("Read the job with the portal's read_job first. If its page will not open, leave the job unrecorded.")
        }
        if (input.state === 'closed' && !readPortal && !readApply) {
          return refuse('Closed needs a page you read in this session that says so. If neither page opened, leave the job unrecorded.')
        }

        const jobs = store.opportunities
        const portalLink = row.portalLink ?? (isPortalLink(row.link) ? row.link : null)
        const isNewLink = !!link && input.apply_page !== 'on-portal' && linkKey(link) !== linkKey(row.link ?? '')
        store.transaction(() => {
          if (isNewLink) jobs.setLink(row.id, link!, portalLink)
          if (input.work_mode && input.work_mode !== row.workMode) jobs.setWorkMode(row.id, input.work_mode)
          if (input.mode.trim() && input.mode.trim() !== row.mode) jobs.setMode(row.id, input.mode.trim())
          if (input.state === 'closed') {
            jobs.setPosting(row.id, 'closed', line)
            jobs.setStatus(row.id, 'dead', ctx.runId)
            jobs.appendNote(row.id, `Closed, found by the posting check (run ${ctx.runId}): "${line}"`)
          } else {
            jobs.setPosting(row.id, input.apply_page === 'unreadable' ? 'unreadable' : 'open', input.apply_page === 'unreadable' ? 'Apply page not readable' : null)
          }
          if (input.notes.trim()) jobs.appendNote(row.id, `Posting check (run ${ctx.runId}): ${input.notes.trim()}`)
        })

        done.add(row.id)
        bump('checked')
        if (input.state === 'closed') bump('closed')
        else if (input.apply_page === 'unreadable') bump('unreadable')
        if (isNewLink) bump('linked')
        ctx.progress('Jobs checked', done.size, rows.length)
        ctx.changed('opportunities')
        ctx.log(
          input.state === 'closed' ? 'warn' : 'good',
          `${row.company}: ${input.state === 'closed' ? 'closed, marked dead' : input.apply_page === 'unreadable' ? 'apply page not readable' : isNewLink ? "the company's apply page saved" : 'still open'}`,
        )
        return say('Recorded.')
      }),
  )
}

const tallyLine = (tally: Tally, of: number): string =>
  [
    `Checked ${tally.checked} of ${of}.`,
    tally.closed ? `${tally.closed} closed, marked dead.` : '',
    tally.linked ? `${tally.linked} now link to the company's apply page.` : '',
    tally.unreadable ? `${tally.unreadable} with an apply page that couldn't be read.` : '',
  ]
    .filter(Boolean)
    .join(' ')

function checkSpec(store: Store, rows: Opportunity[], total: Tally, lane: string): FlowSpec<z.infer<typeof Output>> {
  const own: Tally = { checked: 0, closed: 0, linked: 0, unreadable: 0 }
  const portals = [...new Set(rows.map(portalOf).filter((portal): portal is Portal => !!portal))]
  return {
    flow: 'check',
    title: 'Check postings',
    laneTitle: lane,
    subtitle: rows.map(row => row.company).join(', '),
    portal: null,
    playbooks: portals,
    system: system(rows),
    prompt: 'Check these jobs.',
    tools: ctx => {
      const pages = applyPages()
      const opened: Opened = new Set()
      const done = new Set<number>()
      ctx.progress('Jobs checked', 0, rows.length)
      // One tally for this session's line, one for the whole run's.
      const bump = (key: keyof Tally): void => {
        own[key]++
        total[key]++
      }
      const hooks = { window: 'week' as const, onSearch: () => undefined }
      const readers = portals.flatMap(portal => huntTools(ctx, portal, hooks).filter(tool => tool.name.endsWith('read_job')).map(tool => noting(tool, portal, opened)))
      const handOver = browserTools(ctx, REFUSE.hunt).filter(tool => tool.name === 'hand_to_user')
      return [...readers, applyPageTool(ctx, pages), recordTool(ctx, store, rows, pages, opened, done, bump), ...handOver]
    },
    output: Output,
    finish: answer => `${tallyLine(own, rows.length)} ${answer.summary}`.trim(),
    maxTurns: 40 + rows.length * 10,
  }
}

/** Checks found jobs against their apply pages: a session per batch of jobs, 5 at a time, each in its own tab. */
export function checkPostingsPlan(store: Store, rows: Opportunity[]): RunPlan {
  const total: Tally = { checked: 0, closed: 0, linked: 0, unreadable: 0 }
  const batches: Opportunity[][] = []
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH))
  const sessions = batches.map((batch, i) => checkSpec(store, batch, total, batches.length > 1 ? `Jobs ${i * BATCH + 1} to ${i * BATCH + batch.length}` : 'Jobs'))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  return {
    flow: 'check',
    title: 'Check postings',
    subtitle: `${rows.length} found jobs, ${BATCH} a session`,
    portal: null,
    sessions,
    atOnce: AT_ONCE,
    unit: 'Batches done',
    finish: outcomes => {
      const unfinished = outcomes.filter(outcome => outcome.status !== 'done').length
      return `${tallyLine(total, rows.length)}${unfinished ? ` ${unfinished} ${unfinished === 1 ? 'batch' : 'batches'} did not finish: its line says why.` : ''}`
    },
  }
}
