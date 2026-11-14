import { z } from 'zod'

import { isPortalLink, linkKey } from '../../shared/links'
import { AT_ONCE, CHECK_STATUSES, PORTALS, WORK_MODES } from '../../shared/types'
import type { Job, Portal } from '../../shared/types'
import { browserTools, guarded, refuse, REFUSE, say } from '../browser/tools'
import type { Store } from '../db/store'
import { huntTools, portalIdOf, READ_BY } from '../portals'
import { defineTool, onePlan } from '../runs/engine'
import type { AnyTool, FlowSpec, RunContext, RunPlan } from '../runs/engine'
import { applyPageTool } from './apply-page'
import { applyOutcome, checkYears, isQuoted, MIN_YEARS, newEvidence, noteReads, postingFor, textsFor, YEARS_QUOTE } from './evidence'
import type { Evidence } from './evidence'

/** Jobs per session: enough to be worth a session, few enough to finish well inside its turns. */
const BATCH = 8

const Output = z.object({ summary: z.string().describe('One line: what these jobs came to') })

/** `closed`: found jobs marked dead; `closedApplied`: postings closed after the user applied, noted only. */
type Tally = { checked: number; closed: number; closedApplied: number; linked: number; unreadable: number }

const NO_TALLY = (): Tally => ({ checked: 0, closed: 0, closedApplied: 0, linked: 0, unreadable: 0 })

function portalOf(row: Job): Portal | null {
  const key = row.portal.toLowerCase()
  return (PORTALS as readonly string[]).includes(key) ? (key as Portal) : null
}

/** The company's apply page already saved on a job, if any. */
const savedApplyOf = (row: Job): string | null => (row.link && !isPortalLink(row.link) ? row.link : null)

/** A job the check can read: on a portal by its id or posting link, or by its saved apply page. */
export function isCheckable(row: Job): boolean {
  const portal = portalOf(row)
  const byPortal = !!portal && READ_BY[portal] === 'id' && !!portalIdOf(portal, row.portalLink)
  const byLink = (!!portal && READ_BY[portal] === 'link' && !!row.portalLink) || !!savedApplyOf(row)
  return (CHECK_STATUSES as readonly string[]).includes(row.status) && (byPortal || byLink)
}

function rowLine(row: Job): string {
  const portal = portalOf(row)
  const reads = [
    portal && READ_BY[portal] === 'id' && portalIdOf(portal, row.portalLink) ? `${portal}_read_job, job id ${portalIdOf(portal, row.portalLink)}` : '',
    portal && READ_BY[portal] === 'link' && row.portalLink ? `${portal}_read_job, link ${row.portalLink}` : '',
    savedApplyOf(row) ? `apply page saved: ${savedApplyOf(row)}` : '',
  ].filter(Boolean)
  return `- Job ${row.id}: ${row.company}, ${row.role}, ${row.status === 'found' ? 'not applied to yet' : 'already applied to'} (${reads.join('; ')})`
}

function system(rows: Job[]): string {
  return [
    'This session checks jobs already in the tracker, some waiting to be applied to and some already applied to, against where their application goes. Nothing is applied to, clicked or sent.',
    '',
    'For each job below, in order:',
    "1. Read it where it was found, with the portal's read_job. A job with only an apply page saved goes straight to step 2.",
    "2. When read_job says applying leaves the portal, or the job has an apply page saved, read_apply_page that link. It is the final word on the job.",
    '3. record_check the job.',
    '',
    'The app takes each job\'s links and apply route from those pages itself: you never type a link. What you give is held to the pages too:',
    '- Closed, expired, filled, no longer accepting applications, or not found, on either page: state "closed", with line the page\'s exact words that say so. For a job already applied to, record it the same way: the app only notes it, and the application stands.',
    '- min_years with years_quote: the page\'s exact words that state the years, copied from what read_job or read_apply_page returned. The app checks the words are there and hold the number. No years stated: null and "".',
    '- An apply page that is a sign-in wall, a bot check, or does not show this job: apply_page_shows_job false, and say what you saw in notes.',
    '- Where the apply page differs from the portal on place or work mode, give its in mode and work_mode, and anything else in notes. Never drop a job for these: the user decides.',
    '- A job whose page will not open (signed out, read_job turned off, or the portal limiting how fast pages open): leave it unrecorded, so it stays as it was for the next check, and name it in your summary.',
    '',
    'The jobs:',
    ...rows.map(rowLine),
    '',
    'Finish when every job is recorded or left for one of those reasons.',
  ].join('\n')
}

function recordTool(ctx: RunContext, store: Store, rows: Job[], evidence: Evidence, done: Set<number>, bump: (key: keyof Tally) => void): AnyTool {
  return defineTool(
    'record_check',
    'Save what you found for one job. A closed job not yet applied to is marked dead; one already applied to keeps its status and gets a note.',
    {
      job: z.number().int().describe('The job number from the list'),
      state: z.enum(['open', 'closed']),
      line: z.string().max(500).describe('Closed: the page\'s exact words that say so. Open: ""'),
      apply_page_shows_job: z
        .boolean()
        .describe('For a job that applies off the portal: whether the apply page you read shows this job (false for a sign-in wall, a bot check, or a page without it). true when it applies on the portal'),
      work_mode: z.enum(WORK_MODES).nullable().describe('As the final page states it, or null to keep what was recorded'),
      min_years: z.number().int().min(0).max(40).nullable().describe(MIN_YEARS),
      years_quote: z.string().max(300).describe(YEARS_QUOTE),
      notes: z.string().max(1000).describe('What differs from what was recorded, or what an unreadable page showed. "" when nothing'),
    },
    input =>
      guarded(async () => {
        const row = rows.find(one => one.id === input.job)
        if (!row) return refuse(`Job ${input.job} is not in this session's list.`)
        if (done.has(row.id)) return say('Already recorded.')

        // Everything saved rests on pages this session read: a page that never opened gives nothing.
        const savedApply = savedApplyOf(row)
        const portal = portalOf(row)
        const read = postingFor(evidence, portal, portal ? portalIdOf(portal, row.portalLink) : null, [row.portalLink, row.link])
        const appliedRead = !!savedApply && evidence.pages.read.has(linkKey(savedApply))
        if (!read && !appliedRead) return refuse("Nothing for this job was read in this session. Read it first; if its page won't open, leave it unrecorded.")
        // Pages are kept under both the link asked for and where it landed, so these find the apply page either way.
        const texts = textsFor(evidence, read, [savedApply, read?.applyUrl])

        const line = input.line.trim()
        if (input.state === 'closed' && !isQuoted(line, texts)) {
          return refuse('line must be the exact words, on a page read for this job, that say it is closed.')
        }
        // A closed posting needs no apply page; an open one that applies off the portal does.
        const apply = input.state === 'closed' && !(read?.applyUrl && evidence.pages.tried.has(linkKey(read.applyUrl))) ? null : applyOutcome(evidence, read, savedApply, input.apply_page_shows_job)
        if (typeof apply === 'string') return refuse(apply)
        const years = checkYears(input.min_years, input.years_quote, texts)
        if (typeof years === 'string') return refuse(years)

        const jobs = store.jobs
        const isFound = row.status === 'found'
        const isNewLink = !!apply?.link && linkKey(apply.link) !== linkKey(row.link ?? '')
        store.transaction(() => {
          jobs.setLinks(row.id, { link: apply?.link ?? null, portalLink: read?.postingLink ?? null, applyRoute: apply?.route ?? read?.route ?? null })
          if (input.work_mode && input.work_mode !== row.workMode) jobs.setWorkMode(row.id, input.work_mode)
          if (years.value !== null && years.quote) jobs.setMinYears(row.id, years.value)
          if (input.state === 'closed') {
            jobs.setPosting(row.id, 'closed', line)
            if (isFound) {
              jobs.setStatus(row.id, 'dead', { runId: ctx.runId })
              jobs.appendNote(row.id, `Closed, found by the posting check (run ${ctx.runId}): "${line}"`)
            } else {
              // Applied already: a closed posting usually means no new applications, not that this one is over.
              jobs.appendNote(row.id, `The posting closed after you applied, seen by the posting check (run ${ctx.runId}): "${line}". Your application stands.`)
            }
          } else {
            jobs.setPosting(row.id, apply?.state ?? 'open', apply?.note ?? null)
          }
          if (input.notes.trim()) jobs.appendNote(row.id, `Posting check (run ${ctx.runId}): ${input.notes.trim()}`)
        })

        done.add(row.id)
        bump('checked')
        if (input.state === 'closed') bump(isFound ? 'closed' : 'closedApplied')
        else if (apply?.state === 'unreadable') bump('unreadable')
        if (isNewLink) bump('linked')
        ctx.progress('Jobs checked', done.size, rows.length)
        ctx.changed('jobs')
        ctx.log(
          input.state === 'closed' ? 'warn' : 'good',
          `${row.company}: ${
            input.state === 'closed'
              ? isFound
                ? 'closed, marked dead'
                : 'posting closed after you applied, noted'
              : apply?.state === 'unreadable'
                ? 'apply page not readable'
                : isNewLink
                  ? 'apply link saved'
                  : 'still open'
          }${years.value !== null ? `, ${years.value}+ years` : ''}`,
        )
        return say('Recorded.')
      }),
  )
}

const tallyLine = (tally: Tally, of: number): string =>
  [
    `Checked ${tally.checked} of ${of}.`,
    tally.closed ? `${tally.closed} closed, marked dead.` : '',
    tally.closedApplied ? `${tally.closedApplied} ${tally.closedApplied === 1 ? 'posting' : 'postings'} you applied to closed, noted on the ${tally.closedApplied === 1 ? 'job' : 'jobs'}.` : '',
    tally.linked ? `${tally.linked} got their apply link.` : '',
    tally.unreadable ? `${tally.unreadable} with an apply page that couldn't be read.` : '',
  ]
    .filter(Boolean)
    .join(' ')

function checkSpec(store: Store, rows: Job[], total: Tally, lane: string): FlowSpec<z.infer<typeof Output>> {
  const own = NO_TALLY()
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
      const evidence = newEvidence()
      const done = new Set<number>()
      ctx.progress('Jobs checked', 0, rows.length)
      // One tally for this session's line, one for the whole run's.
      const bump = (key: keyof Tally): void => {
        own[key]++
        total[key]++
      }
      const hooks = { window: 'week' as const, onSearch: () => undefined }
      const readers = portals.flatMap(portal => huntTools(ctx, portal, hooks, noteReads(evidence)).filter(tool => tool.name.endsWith('read_job')))
      const handOver = browserTools(ctx, REFUSE.hunt).filter(tool => tool.name === 'hand_to_user')
      return [...readers, applyPageTool(ctx, evidence.pages), recordTool(ctx, store, rows, evidence, done, bump), ...handOver]
    },
    output: Output,
    finish: answer => `${tallyLine(own, rows.length)} ${answer.summary}`.trim(),
    maxTurns: 40 + rows.length * 10,
  }
}

/** Checks found and applied jobs against their apply pages: a session per batch of jobs, 5 at a time, each in its own tab. */
export function checkPostingsPlan(store: Store, rows: Job[]): RunPlan {
  const total = NO_TALLY()
  const batches: Job[][] = []
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH))
  const sessions = batches.map((batch, i) => checkSpec(store, batch, total, batches.length > 1 ? `Jobs ${i * BATCH + 1} to ${i * BATCH + batch.length}` : 'Jobs'))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  return {
    flow: 'check',
    title: 'Check postings',
    subtitle: `${rows.length} jobs, ${BATCH} a session`,
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
