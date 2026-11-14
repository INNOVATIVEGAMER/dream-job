import { z } from 'zod'

import type { HuntWindow } from '../../shared/types'
import type { ApplyRecord } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { isKnown, portalTool, refuse, say, SCROLL_TO_END, sleep, waitFor } from './common'
import type { OnRead } from './common'

/*
 * OnlyFrontendJobs' own tools, written from its live pages. No account is
 * needed to read it.
 * - /remote-frontend-jobs lists remote roles and /jobs every role, newest
 *   first, 50 at a time; more load as the page scrolls. Each card links to
 *   /jobs/<slug>-<id> and reads: title, company, country, an "EASY APPLY"
 *   tag on some, place, Remote/Hybrid/Onsite, level with years ("Mid (2+
 *   years)"), age ("Today", "6 days ago"), a summary and skills.
 * - A posting carries a structured JobPosting record: title, description,
 *   datePosted, employmentType, hiringOrganization, jobLocationType
 *   (TELECOMMUTE for remote), applicantLocationRequirements (the countries it
 *   hires from), experienceRequirements.monthsOfExperience, skills, and
 *   applicationContact.url: the company's own posting, where the
 *   application goes.
 */

const BASE = 'https://www.onlyfrontendjobs.com'

/** The posting's address from its link or path: /jobs/<slug>-<id>. */
function postingUrl(link: string): string | null {
  try {
    const url = new URL(link.startsWith('http') ? link : `${BASE}${link.startsWith('/') ? '' : '/'}${link}`)
    if (!/(^|\.)onlyfrontendjobs\.com$/.test(url.hostname) || !/^\/jobs\/[a-z0-9-]+-\d+$/.test(url.pathname)) return null
    return BASE + url.pathname
  } catch {
    return null
  }
}

const idOf = (url: string): string => /-(\d+)$/.exec(new URL(url).pathname)?.[1] ?? ''

type Card = { link: string; jobId: string; title: string; company: string; lines: string[]; age: string }

const CARDS_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const seen = new Set();
  const cards = [];
  for (const a of document.querySelectorAll('a[href^="/jobs/"]')) {
    const path = a.getAttribute('href');
    const m = /^\/jobs\/[a-z0-9-]+-(\d+)$/.exec(path);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const box = a.closest('li, article') || a;
    const lines = box.innerText.split('\n').map(clean).filter(Boolean);
    cards.push({ link: path, jobId: m[1], title: lines[0] || '', company: lines[1] || '', lines: lines.slice(2, 9).filter(l => l.length < 90), age: lines.find(l => /^(today|yesterday)$|\bago$/i.test(l)) || '' });
  }
  return { cards, showing: clean((document.body.innerText.match(/Showing[^\n]{0,60}/) || [''])[0]) };
})()`

type Posting = {
  found: boolean
  title: string
  company: string
  header: string
  posted: string
  employment: string
  remote: boolean
  regions: string[]
  months: number | null
  skills: string
  applyUrl: string | null
  about: string
  closed: boolean
}

/** Reads a posting whole from its structured record, and the line under its title as the page shows it. */
const JOB_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const text = html => { const d = document.createElement('div'); d.innerHTML = (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '$&- ').replace(/<\/(p|li|h[1-6]|div|ul|ol|tr)>/gi, '$&\n'); return (d.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); };
  let job = null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const j = JSON.parse(s.textContent); if (j && j['@type'] === 'JobPosting') job = j; } catch {}
  }
  const main = document.querySelector('main') || document.body;
  const lines = main.innerText.split('\n').map(clean).filter(Boolean);
  if (!job) return { found: false, closed: /not found|no longer|expired|closed/i.test(lines.slice(0, 20).join(' ')) };
  const regions = (Array.isArray(job.applicantLocationRequirements) ? job.applicantLocationRequirements : [job.applicantLocationRequirements]).filter(Boolean).map(r => r.name || '').filter(Boolean);
  const months = job.experienceRequirements && Number(job.experienceRequirements.monthsOfExperience);
  return {
    found: true,
    title: job.title || '',
    company: (job.hiringOrganization && job.hiringOrganization.name) || '',
    header: lines.find(l => / · /.test(l) && /remote|hybrid|onsite|on-site|yrs|year/i.test(l)) || '',
    posted: job.datePosted || '',
    employment: [].concat(job.employmentType || []).join(', '),
    remote: job.jobLocationType === 'TELECOMMUTE',
    regions,
    months: Number.isFinite(months) ? months : null,
    skills: [].concat(job.skills || []).join(', '),
    applyUrl: (job.applicationContact && job.applicationContact.url) || null,
    about: text(job.description),
    closed: !!(job.validThrough && new Date(job.validThrough) < new Date()),
  };
})()`

const WINDOW_DAYS: Record<HuntWindow, number> = { day: 1, week: 7, month: 31 }

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

function formatPosting(posting: Posting, url: string): string {
  const years = posting.months !== null ? Math.floor(posting.months / 12) : null
  return [
    `${posting.title} at ${posting.company}`,
    `Job id ${idOf(url)}, link: ${url}`,
    posting.header ? `As the page shows it: ${posting.header}` : '',
    `Work mode: ${posting.remote ? 'Remote' : 'not remote (see the place below)'}`,
    posting.regions.length ? `Hires from: ${posting.regions.join(', ')}` : '',
    years !== null ? `Experience asked: ${years}+ years (the posting's job record: ${posting.months} months)` : 'Experience asked: not in the job record',
    posting.employment ? `Employment: ${posting.employment}` : '',
    posting.posted ? `Posted: ${posting.posted.slice(0, 10)}` : '',
    posting.skills ? `Skills: ${posting.skills}` : '',
    posting.applyUrl ? `Apply route: the company's site: ${posting.applyUrl}` : 'Apply route: no link to the company\'s posting in the record',
    'Pay: not shown',
    '',
    'The posting:',
    posting.about,
  ]
    .filter(line => line !== '')
    .join('\n')
}

/**
 * OnlyFrontendJobs' tools for a flow. The hunt gets search_jobs and
 * read_job. Applying happens on the company's own site, so apply gets
 * read_job alone.
 */
export function onlyfrontendjobsTools(
  ctx: RunContext,
  options: { hunt?: { window: HuntWindow; onSearch: (search: string | null, postings: string[]) => void }; apply?: ApplyRecord; onRead?: OnRead },
): AnyTool[] {
  const tools: AnyTool[] = []

  if (options.hunt) {
    const hunt = options.hunt
    tools.push(
      portalTool(
        ctx,
        'onlyfrontendjobs',
        'search_jobs',
        'List OnlyFrontendJobs postings, newest first, within the hunt window: remote roles only, or every role. Answers new postings only; ones the user has seen are left out and counted. Call it once per kind.',
        { remote_only: z.boolean().describe('true: remote roles; false: every role, remote or not') },
        async ({ remote_only }) => {
          await ctx.chrome.openPage(`${BASE}${remote_only ? '/remote-frontend-jobs' : '/jobs'}`)
          await waitFor(ctx, `document.querySelector('a[href^="/jobs/"]')`, 12_000)
          const limit = WINDOW_DAYS[hunt.window]
          let read = await ctx.chrome.evaluate<{ cards: Card[]; showing: string }>(CARDS_SCRIPT)
          // More load as the page scrolls: keep going while the oldest card is still inside the window.
          for (let i = 0; i < 6; i++) {
            const last = read.cards[read.cards.length - 1]
            if (!last || (ageInDays(last.age) ?? 0) > limit) break
            const before = read.cards.length
            await ctx.chrome.evaluate(SCROLL_TO_END, true)
            await sleep(1500)
            read = await ctx.chrome.evaluate<{ cards: Card[]; showing: string }>(CARDS_SCRIPT)
            if (read.cards.length === before) break
          }
          const inWindow = read.cards.filter(card => (ageInDays(card.age) ?? 0) <= limit)
          const fresh = inWindow.filter(card => !isKnown(ctx, 'onlyfrontendjobs', card.jobId, card.company, card.title))
          const left = inWindow.length - fresh.length
          if (left) ctx.count('skipped', left)
          hunt.onSearch(`onlyfrontendjobs:${remote_only}`, fresh.map(card => `onlyfrontendjobs:${card.jobId}`))
          return say(
            [
              `OnlyFrontendJobs ${remote_only ? 'remote' : 'all'}: ${read.showing || `${read.cards.length} roles`}; ${inWindow.length} inside the window, ${fresh.length} new, ${left} already known.`,
              ...fresh.map(card => [`[${card.jobId}] ${card.title}`, card.company, ...card.lines, `link ${BASE}${card.link}`].filter(Boolean).join(' | ')),
            ].join('\n'),
          )
        },
      ),
    )
  }

  tools.push(
    portalTool(
      ctx,
      'onlyfrontendjobs',
      'read_job',
      "Read one OnlyFrontendJobs posting by its link (/jobs/<slug>-<id>): work mode, the countries it hires from, years asked, when posted, skills, the description, and the company's own posting where the application goes.",
      { link: z.string().max(300).describe('The posting\'s link from search_jobs, /jobs/<slug>-<id>') },
      async ({ link }) => {
        const url = postingUrl(link)
        if (!url) return refuse('That is not an OnlyFrontendJobs posting link. It looks like /jobs/<slug>-<id>.')
        await ctx.chrome.openPage(url)
        await waitFor(ctx, `document.querySelector('script[type="application/ld+json"]') && document.querySelector('h1')`, 10_000)
        const posting = await ctx.chrome.evaluate<Posting>(JOB_SCRIPT)
        if (!posting.found) return refuse(posting.closed ? 'OnlyFrontendJobs says this posting is gone: treat it as closed.' : 'This page has no job record: read it with read_page to see what it shows.')
        ctx.count('read')
        if (options.apply) options.apply.posting = { closed: posting.closed, route: 'company-site', applyUrl: posting.applyUrl }
        const text = formatPosting(posting, url)
        options.onRead?.({ portal: 'onlyfrontendjobs', jobId: idOf(url), postingLink: url, route: 'company-site', applyUrl: posting.applyUrl, closed: posting.closed, text })
        return say(text)
      },
    ),
  )

  return tools
}
