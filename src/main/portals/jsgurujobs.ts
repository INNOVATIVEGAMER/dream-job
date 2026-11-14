import { z } from 'zod'

import type { HuntWindow } from '../../shared/types'
import type { ApplyRecord } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { isKnown, markSite, portalTool, refuse, say, waitFor } from './common'
import type { OnRead } from './common'

/*
 * JSGuruJobs' own tools, written from its live pages:
 * - /jobs is a plain GET form: search, country (two-letter code, such as in),
 *   work_mode (remote, hybrid, onsite), type, page. Ten cards a page, newest
 *   first. Each card: title (h3 a to /jobs/<id>), company, place, job type,
 *   pay or "Not specified", work format, region, and "4 days ago".
 * - A posting is /jobs/<id>: "Location", "Job Type", "Work Format",
 *   "Salary" and "Posted" (a date) as label and value, then "Job
 *   Description". No structured job record.
 * - Signed out, the posting offers only "Login to Apply". Signed in, "Apply
 *   Now" links to /jobs/<id>/apply-out, which redirects once to the
 *   company's own posting (Ashby, Lever, Greenhouse...). That redirect is how
 *   the app learns where the application goes.
 */

const BASE = 'https://jsgurujobs.com'
export const jobLink = (jobId: string): string => `${BASE}/jobs/${jobId}`

type Card = { jobId: string; title: string; company: string; lines: string[]; age: string }

const CARDS_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const cards = [];
  for (const a of document.querySelectorAll('h3 a[href*="/jobs/"]')) {
    const m = /\/jobs\/(\d+)$/.exec(new URL(a.href).pathname);
    if (!m) continue;
    // The card: the largest box that still holds this one job.
    let box = a;
    while (box.parentElement && box.parentElement.querySelectorAll('h3 a[href*="/jobs/"]').length === 1) box = box.parentElement;
    const lines = box.innerText.split('\n').map(clean).filter(Boolean).filter(l => l.length > 1 || /\d/.test(l));
    const title = clean(a.innerText);
    const at = lines.indexOf(title);
    cards.push({ jobId: m[1], title, company: lines[at + 1] || '', lines: lines.slice(at + 2, at + 9).filter(l => l.length < 80), age: lines.find(l => /\bago\b|^today$|^yesterday$/i.test(l)) || '' });
  }
  const next = [...document.querySelectorAll('a[href*="page="]')].some(a => /next/i.test(a.innerText));
  return { cards, next };
})()`

type Posting = {
  title: string
  company: string
  facts: Record<string, string>
  about: string
  applyOut: string | null
  signedIn: boolean
  notFound: boolean
}

/** Reads a posting whole: its facts and every line of the description. */
const JOB_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main') || document.body;
  const lines = main.innerText.split('\n').map(clean).filter(Boolean);
  const facts = {};
  for (const label of ['Location', 'Job Type', 'Work Format', 'Salary', 'Posted']) {
    const at = lines.indexOf(label);
    if (at >= 0 && lines[at + 1]) facts[label] = lines[at + 1];
  }
  const start = lines.indexOf('Job Description');
  const out = [...document.querySelectorAll('a[href*="/apply-out"]')][0];
  const h1 = document.querySelector('h1');
  return {
    title: clean(h1 && h1.innerText),
    company: (() => { const t = document.title.replace(/ - JavaScript Jobs Hub$/, ''); const at = t.lastIndexOf(' at '); return at > 0 ? t.slice(at + 4) : ''; })(),
    facts,
    about: (() => {
      if (start < 0) return '';
      // The employer's words end where the board's own sections start: its summary, likely questions, skills, related jobs.
      let about = main.innerText.slice(main.innerText.indexOf('Job Description') + 15);
      const stops = ['Who is this job for?', 'Potential Interview Questions', 'Job Summary', 'Required Skills', 'Never miss a JavaScript opportunity', 'Related jobs'];
      const cut = Math.min(...stops.map(stop => about.indexOf(stop)).filter(at => at >= 0));
      if (Number.isFinite(cut)) about = about.slice(0, cut);
      return about.replace(/\n{3,}/g, '\n\n').trim();
    })(),
    applyOut: out ? out.href : null,
    signedIn: !!out || !/Login to Apply/i.test(main.innerText),
    notFound: !h1 || /not found|no longer (available|accepting)|404/i.test(document.title + ' ' + lines.slice(0, 12).join(' ')),
  };
})()`

/** How far back a card may be, in days, for the hunt's window. */
const WINDOW_DAYS: Record<HuntWindow, number> = { day: 1, week: 7, month: 31 }

/** "4 days ago" as days; null when the card shows no age. */
function ageInDays(age: string): number | null {
  const text = age.toLowerCase()
  if (!text) return null
  if (/today|just now|hour|minute/.test(text)) return 0
  if (/yesterday/.test(text)) return 1
  const m = /(\d+|an?)\s+(day|week|month|year)/.exec(text)
  if (!m) return null
  const n = m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1])
  return n * { day: 1, week: 7, month: 30, year: 365 }[m[2] as 'day' | 'week' | 'month' | 'year']
}

/** Opens a posting, and when signed in follows its apply link to the company's page to learn where it lands. */
async function openPosting(ctx: RunContext, jobId: string): Promise<{ posting: Posting; applyUrl: string | null }> {
  await ctx.chrome.openPage(jobLink(jobId))
  await waitFor(ctx, `document.querySelector('h1') || /not found/i.test(document.title)`, 10_000)
  const posting = await ctx.chrome.evaluate<Posting>(JOB_SCRIPT)
  markSite(ctx, 'jsgurujobs', posting.signedIn ? 'signed-in' : 'signed-out')
  if (!posting.applyOut || posting.notFound) return { posting, applyUrl: null }
  // The apply link redirects once, off JSGuruJobs: where it lands is where the application goes.
  await ctx.chrome.openPage(posting.applyOut).catch(() => undefined)
  const landed = (await ctx.chrome.page().catch(() => ({ url: '' }))).url
  return { posting, applyUrl: landed && !/(^|\.)jsgurujobs\.com$/.test(new URL(landed).hostname) ? landed : null }
}

function formatPosting(posting: Posting, jobId: string, applyUrl: string | null): string {
  return [
    `${posting.title} at ${posting.company}`,
    `Job id ${jobId}, link: ${jobLink(jobId)}`,
    ...Object.entries(posting.facts).map(([label, value]) => `${label}: ${value}`),
    applyUrl ? `Apply route: the company's site: ${applyUrl}` : 'Apply route: the company site, but its link did not resolve',
    '',
    'The posting:',
    posting.about,
  ]
    .filter(line => line !== '')
    .join('\n')
}

/**
 * JSGuruJobs' tools for a flow. The hunt gets search_jobs and read_job.
 * Applying happens on the company's own site, so apply gets read_job alone.
 */
export function jsgurujobsTools(
  ctx: RunContext,
  options: { hunt?: { window: HuntWindow; onSearch: (search: string | null, postings: string[]) => void }; apply?: ApplyRecord; onRead?: OnRead },
): AnyTool[] {
  const tools: AnyTool[] = []

  if (options.hunt) {
    const hunt = options.hunt
    tools.push(
      portalTool(
        ctx,
        'jsgurujobs',
        'search_jobs',
        'Search JSGuruJobs, newest first, within the hunt window. Answers new postings only; ones the user has seen are left out and counted. Ten a page: call with page 2 and on while the page was mostly new and inside the window.',
        {
          country: z.string().regex(/^[a-z]{2}$/).optional().describe('Two-letter country code, such as "in" for India: postings open to that country, remote and local'),
          work_mode: z.enum(['remote', 'hybrid', 'onsite', 'any']),
          search: z.string().max(80).optional().describe('Words to search for, or leave out'),
          page: z.number().int().min(1).max(10).optional(),
        },
        async ({ country, work_mode, search, page }) => {
          const url = new URL(`${BASE}/jobs`)
          if (search) url.searchParams.set('search', search)
          if (country) url.searchParams.set('country', country)
          if (work_mode !== 'any') url.searchParams.set('work_mode', work_mode)
          if (page && page > 1) url.searchParams.set('page', String(page))
          await ctx.chrome.openPage(url.toString())
          await waitFor(ctx, `document.querySelector('h3 a[href*="/jobs/"]') || /no jobs found|0 jobs/i.test(document.body.innerText)`, 10_000)
          const { cards, next } = await ctx.chrome.evaluate<{ cards: Card[]; next: boolean }>(CARDS_SCRIPT)
          const limit = WINDOW_DAYS[hunt.window]
          const inWindow = cards.filter(card => (ageInDays(card.age) ?? 0) <= limit)
          const fresh = inWindow.filter(card => !isKnown(ctx, 'jsgurujobs', card.jobId, card.company, card.title))
          const left = inWindow.length - fresh.length
          if (left) ctx.count('skipped', left)
          hunt.onSearch(page && page > 1 ? null : `jsgurujobs:${country ?? ''}:${work_mode}:${search ?? ''}`, fresh.map(card => `jsgurujobs:${card.jobId}`))
          const older = cards.length - inWindow.length
          return say(
            [
              `JSGuruJobs page ${page ?? 1}: ${cards.length} cards, ${fresh.length} new, ${left} already known${older ? `, ${older} older than the window` : ''}.${next && !older ? ' There is a next page.' : ''}`,
              ...fresh.map(card => [`[${card.jobId}] ${card.title}`, card.company, ...card.lines, card.age].filter(Boolean).join(' | ')),
            ].join('\n'),
          )
        },
      ),
    )
  }

  tools.push(
    portalTool(
      ctx,
      'jsgurujobs',
      'read_job',
      "Read one JSGuruJobs posting by its job id: place, job type, work format, pay, when posted, the description, and the company's own apply page its Apply link leads to.",
      { job_id: z.string().regex(/^\d+$/, 'A JSGuruJobs job id is digits only') },
      async ({ job_id }) => {
        const { posting, applyUrl } = await openPosting(ctx, job_id)
        if (posting.notFound) return refuse('JSGuruJobs has no such posting now: treat it as closed.')
        if (!posting.signedIn || !posting.applyOut) {
          return refuse('JSGuruJobs is signed out in the app\'s Chrome, so its apply link is hidden. Call hand_to_user with what "sign-in", then read the posting again.')
        }
        ctx.count('read')
        if (options.apply) options.apply.posting = { closed: false, route: 'company-site', applyUrl }
        const text = formatPosting(posting, job_id, applyUrl)
        options.onRead?.({ portal: 'jsgurujobs', jobId: job_id, postingLink: jobLink(job_id), route: 'company-site', applyUrl, closed: false, text })
        return say(text)
      },
    ),
  )

  return tools
}
