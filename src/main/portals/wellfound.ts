import { z } from 'zod'

import { HUNT_WINDOW_NAMES } from '../../shared/types'
import type { HuntWindow, WrittenAnswer } from '../../shared/types'
import { approveWritten, readPage, setField } from '../browser/tools'
import type { ApplyRecord } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { clickPoint, isKnown, markSite, portalTool, refuse, say, SCROLL_TO_END, sleep, stageLine, waitFor } from './common'

/*
 * Wellfound's own tools, written from its live pages:
 * - /jobs is the job search saved on the user's Wellfound account: roles,
 *   places and pay are set there, not in the address. Sort by offers
 *   Recommended, Most recent and Last Active. Each company is one
 *   [data-test="StartupResult"] card (name, "51-200 Employees", stage), and
 *   each of its jobs one link to /jobs/<id>-<slug> holding the title,
 *   places, pay ("₹10L – ₹20L • 0.05% – 0.1%") and "Posted 1 week ago".
 * - A posting needs its full /jobs/<id>-<slug> path; the id alone is a 404.
 *   It has [data-test="JobDetail"] (pay, posted, description) and
 *   [data-test="Sidebar"] (website, locations, company size, type).
 * - Apply opens a role="dialog" with the posting's facts (location, remote
 *   policy, where it hires remotely, visa sponsorship, experience, skills),
 *   the note "What interests you about working for this company?", maybe more
 *   questions, Cancel and Send application.
 * - Signed in, every page has [data-test="UserMenu"].
 */

const WINDOW_DAYS: Record<HuntWindow, number> = { day: 1, week: 7, month: 31 }

const SIGNED_IN = `!!document.querySelector('[data-test="UserMenu"], [data-test="CandidateLeftNav"]')`

const linkOf = (path: string): string => `https://wellfound.com${path.startsWith('/') ? path : `/${path}`}`

type Job = {
  jobId: string
  path: string
  title: string
  company: string
  size: string
  stageLabel: string
  places: string[]
  pay: string
  flags: string[]
  posted: string
  days: number | null
  applied: boolean
}

const SEARCH_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const leaves = el => [...el.querySelectorAll('*')].filter(n => n.children.length === 0).map(n => clean(n.textContent)).filter(t => t && !/^icn_/.test(t));
  const days = text => {
    const m = (text || '').match(/posted\s+(today|yesterday|(\d+|an?|one)\s+(hour|day|week|month|year)s?\s+ago)/i);
    if (!m) return null;
    if (/today/i.test(m[1])) return 0;
    if (/yesterday/i.test(m[1])) return 1;
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : 1;
    return { hour: 0, day: n, week: 7 * n, month: 30 * n, year: 365 * n }[m[3].toLowerCase()];
  };
  const jobs = [];
  const seen = new Set();
  for (const card of document.querySelectorAll('[data-test="StartupResult"]')) {
    const head = leaves(card);
    const companyLink = card.querySelector('a[href^="/company/"]');
    // The company link wraps its name, tagline and size: the name is its first line.
    const company = clean(companyLink ? companyLink.innerText.split('\n').map(clean).find(Boolean) : '') || head[0] || '';
    const size = head.find(t => /employees$/i.test(t)) || '';
    const stageLabel = head.find(t => /(Early|Growth|Late) Stage|Acquired|Public/i.test(t)) || '';
    for (const a of card.querySelectorAll('a[href^="/jobs/"]')) {
      const path = a.getAttribute('href').split('?')[0];
      const m = path.match(/^\/jobs\/(\d+)-/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const bits = leaves(a).filter(t => t !== 'More');
      const payAt = bits.findIndex(t => /[₹$€£]\s?\d|\d+k\b/i.test(t));
      const text = a.innerText;
      jobs.push({
        jobId: m[1], path, title: bits[0] || '', company, size, stageLabel,
        places: bits.slice(1, payAt > 0 ? payAt : 5).filter(t => !/^posted/i.test(t)),
        pay: payAt > 0 ? bits[payAt] : '',
        flags: (payAt > 0 ? bits.slice(payAt + 1) : []).filter(t => !/^posted/i.test(t)).slice(0, 3),
        posted: clean((text.match(/posted[^\n]*/i) || [''])[0]),
        days: days(text),
        applied: /\bApplied\b/.test(text),
      });
    }
  }
  const results = document.querySelector('[data-test="JobSearchResults"]') || document.body;
  return {
    count: (results.innerText.match(/\d[\d,]* results?/) || [''])[0],
    jobs,
    signedIn: ${SIGNED_IN},
  };
})()`

/** The Sort by control, and what it is set to. */
const SORT_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const shown = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const button = [...document.querySelectorAll('button')].filter(shown).find(b => /^(Recommended|Most recent|Last Active)$/.test(clean(b.innerText)));
  if (!button) return { none: true };
  const box = button.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, text: clean(button.innerText) };
})()`

const MOST_RECENT_SCRIPT = String.raw`(() => {
  const shown = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const option = [...document.querySelectorAll('li, [role="option"], [role="menuitem"]')].filter(shown).find(e => /^\s*Most recent/.test(e.innerText));
  if (!option) return { none: true };
  const box = option.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`

type Posting = {
  title: string
  company: string
  where: string
  pay: string
  posted: string
  route: 'wellfound' | 'company-site' | 'unknown'
  applyUrl: string | null
  applied: boolean
  size: string
  side: string[]
  about: string
  isCut: boolean
  signedIn: boolean
  notFound: boolean
}

export const JOB_SCRIPT = (maxChars: number): string => String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const detail = document.querySelector('[data-test="JobDetail"]');
  const side = document.querySelector('[data-test="Sidebar"]');
  const parts = document.title.replace(/ \| Wellfound$/, '').split(' • ');
  const at = parts[0].lastIndexOf(' at ');
  const lines = detail ? detail.innerText.split('\n').map(clean).filter(Boolean) : [];
  const head = lines.slice(0, 8);
  const controls = detail ? [...detail.querySelectorAll('button, a')] : [];
  const apply = controls.find(b => /^Apply( now)?$/i.test(clean(b.innerText)));
  const external = controls.find(b => b.tagName === 'A' && /apply/i.test(b.innerText) && b.href && !/(^|\.)wellfound\.com$/.test(new URL(b.href).hostname));
  const sideLines = side ? side.innerText.split('\n').map(clean).filter(Boolean) : [];
  const sizeAt = sideLines.findIndex(l => /^Company size$/i.test(l));
  const startAt = Math.max(0, head.findIndex(l => /^Apply( now)?$/i.test(l)) + 1);
  const body = lines.slice(startAt).join('\n');
  return {
    title: at > 0 ? parts[0].slice(0, at) : parts[0],
    company: at > 0 ? parts[0].slice(at + 4) : '',
    where: parts.slice(1).join(' • '),
    pay: head.find(l => /[₹$€£]\s?\d|\d+k\b/i.test(l)) || '',
    posted: head.find(l => /^posted/i.test(l)) || '',
    route: external ? 'company-site' : apply ? 'wellfound' : 'unknown',
    applyUrl: external ? external.href : null,
    applied: controls.some(b => /^Applied$/i.test(clean(b.innerText))),
    size: sizeAt >= 0 ? sideLines[sizeAt + 1] || '' : '',
    side: sideLines.slice(0, 16),
    about: body.slice(0, ${maxChars}),
    isCut: body.length > ${maxChars},
    signedIn: ${SIGNED_IN},
    notFound: /Page not found/i.test(document.title),
  };
})()`

/** The open apply dialog, as an expression for the page. */
const APPLY_DIALOG = `[...document.querySelectorAll('[role="dialog"]')].filter(d => { const b = d.getBoundingClientRect(); return b.width > 0 && b.height > 0 }).find(d => /Send application/.test(d.innerText))`

const APPLY_BUTTON = String.raw`(() => {
  const detail = document.querySelector('[data-test="JobDetail"]') || document.body;
  const b = [...detail.querySelectorAll('button')].find(b => /^Apply( now)?$/i.test((b.innerText || '').trim()));
  if (!b) return { none: true };
  b.scrollIntoView({ block: 'center' });
  const box = b.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`

const SEND_BUTTON = String.raw`(() => {
  const dialog = ${APPLY_DIALOG};
  if (!dialog) return { none: true };
  const b = dialog.querySelector('[data-test="JobApplicationModal--SubmitButton"]') || [...dialog.querySelectorAll('button')].find(b => /^Send application$/i.test(b.innerText.trim()));
  if (!b) return { none: true };
  b.scrollIntoView({ block: 'center' });
  const box = b.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, disabled: b.disabled };
})()`

type Point = { x?: number; y?: number; none?: boolean; disabled?: boolean; text?: string }

function checkLink(link: string): string | null {
  try {
    const url = new URL(link.startsWith('http') ? link : linkOf(link))
    if (!/(^|\.)wellfound\.com$/.test(url.hostname) || !/^\/jobs\/\d+-/.test(url.pathname)) return null
    return url.origin + url.pathname
  } catch {
    return null
  }
}

async function openPosting(ctx: RunContext, url: string): Promise<Posting> {
  const here = await ctx.chrome.page().catch(() => ({ url: '' }))
  if (!here.url.startsWith(url)) await ctx.chrome.openPage(url)
  await waitFor(ctx, `document.querySelector('[data-test="JobDetail"]') || /Page not found/i.test(document.title)`, 10_000)
  const posting = await ctx.chrome.evaluate<Posting>(JOB_SCRIPT(5000))
  markSite(ctx, 'wellfound', posting.signedIn ? 'signed-in' : 'signed-out')
  return posting
}

function formatPosting(posting: Posting, url: string): string {
  return [
    `${posting.title} at ${posting.company}`,
    `Link: ${url}`,
    posting.where ? `Where: ${posting.where}` : '',
    `Pay: ${posting.pay || 'not shown'}`,
    posting.posted ? posting.posted : '',
    `Apply route: ${posting.route === 'wellfound' ? 'on Wellfound, with a note' : posting.route === 'company-site' ? `the company's site: ${posting.applyUrl}` : 'not found on the page'}`,
    posting.applied ? 'Already applied on Wellfound.' : '',
    `About the company: ${posting.side.join(' | ') || 'not shown'}`,
    stageLine(posting.size),
    '',
    'The posting:',
    posting.about + (posting.isCut ? '\n[cut here]' : ''),
  ]
    .filter(line => line !== '')
    .join('\n')
}

export type WellfoundHunt = {
  window: HuntWindow
  /** Each search run (null for a later page of one already counted), with the new postings it found as portal:id. */
  onSearch: (search: string | null, postings: string[]) => void
}

/**
 * Wellfound's tools for a flow. The hunt gets search_jobs and read_job; apply
 * gets read_job and apply, which write what was sent into `record`.
 */
export function wellfoundTools(ctx: RunContext, options: { hunt?: WellfoundHunt; apply?: ApplyRecord }): AnyTool[] {
  const tools: AnyTool[] = []

  if (options.hunt) {
    const hunt = options.hunt
    tools.push(
      portalTool(
        ctx,
        'wellfound',
        'search_jobs',
        `Read the job search saved on the user's Wellfound account (the roles, places and pay they set on Wellfound), newest first, keeping postings from ${HUNT_WINDOW_NAMES[hunt.window].toLowerCase()}. Answers only postings new to the user; the rest are left out and counted. Call it once.`,
        {},
        async () => {
          await ctx.chrome.openPage('https://wellfound.com/jobs')
          await waitFor(ctx, `document.querySelector('[data-test="StartupResult"]') || /\\b0 results\\b/.test(document.body.innerText) || /\\/login/.test(location.pathname)`, 12_000)
          if (!(await ctx.chrome.evaluate<boolean>(SIGNED_IN, true))) {
            markSite(ctx, 'wellfound', 'signed-out')
            return refuse('Wellfound is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then search again.')
          }
          markSite(ctx, 'wellfound', 'signed-in')

          // Newest first, so reading can stop at the window's edge.
          const sort = await ctx.chrome.evaluate<Point>(SORT_SCRIPT)
          if (!sort.none && sort.text !== 'Most recent') {
            await clickPoint(ctx, sort)
            await sleep(500)
            const option = await ctx.chrome.evaluate<Point>(MOST_RECENT_SCRIPT)
            if (!option.none) {
              await clickPoint(ctx, option)
              await sleep(2500)
            }
          }

          const limit = WINDOW_DAYS[hunt.window]
          let result = await ctx.chrome.evaluate<{ count: string; jobs: Job[] }>(SEARCH_SCRIPT)
          for (let i = 0; i < 8; i++) {
            const last = result.jobs[result.jobs.length - 1]
            if (!last || (last.days !== null && last.days > limit)) break
            await ctx.chrome.evaluate(SCROLL_TO_END, true)
            await sleep(1800)
            const next = await ctx.chrome.evaluate<{ count: string; jobs: Job[] }>(SEARCH_SCRIPT)
            if (next.jobs.length === result.jobs.length) break
            result = next
          }

          const inWindow = result.jobs.filter(job => job.days === null || job.days <= limit)
          const fresh = inWindow.filter(job => !job.applied && !isKnown(ctx, 'wellfound', job.jobId, job.company, job.title))
          const left = inWindow.length - fresh.length
          if (left) ctx.count('skipped', left)
          hunt.onSearch('wellfound', fresh.map(job => `wellfound:${job.jobId}`))
          return say(
            [
              `Wellfound search: ${result.count || 'results'}; ${inWindow.length} posted within ${HUNT_WINDOW_NAMES[hunt.window].toLowerCase()}, ${fresh.length} new, ${left} left out as already known.`,
              ...fresh.map(job =>
                [`[${job.jobId}] ${job.title}`, job.company, job.size, job.stageLabel, job.places.join(', '), job.pay || 'pay not shown', job.posted, ...job.flags, `link: ${linkOf(job.path)}`]
                  .filter(Boolean)
                  .join(' | '),
              ),
            ].join('\n'),
          )
        },
      ),
    )
  }

  tools.push(
    portalTool(
      ctx,
      'wellfound',
      'read_job',
      'Read one Wellfound posting by its link: title, company, where, pay and equity, when posted, how to apply, whether already applied, the company\'s size with its stage bucket, and the posting itself.',
      { link: z.string().describe('The posting\'s link, wellfound.com/jobs/<id>-<slug>') },
      async ({ link }) => {
        const url = checkLink(link)
        if (!url) return refuse('That is not a Wellfound posting link. It looks like https://wellfound.com/jobs/<id>-<slug>.')
        const posting = await openPosting(ctx, url)
        if (posting.notFound) return refuse('Wellfound says this posting does not exist: it was taken down. Treat it as closed.')
        if (!posting.signedIn) return refuse('Wellfound is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then read the posting again.')
        ctx.count('read')
        if (options.apply) options.apply.posting = { closed: false, route: posting.route, applyUrl: posting.applyUrl }
        return say(formatPosting(posting, url))
      },
    ),
  )

  if (options.apply) {
    const record = options.apply
    tools.push(
      portalTool(
        ctx,
        'wellfound',
        'apply',
        [
          'Apply to a Wellfound posting. Called with no answers, it opens the application form and reads it: the posting\'s facts, the note to the company ("What interests you about working for this company?") and any other questions, numbered.',
          'Called with answers, it fills each by its number and sends the application. Mark each answer "fact" (from the profile or saved answers) or "written" (free text you composed in the user\'s voice). The note is a written answer: always write one.',
          'Written answers are shown to the user first, who may edit them or decline; declining leaves it unsent.',
        ].join(' '),
        {
          link: z.string().describe('The posting\'s link'),
          answers: z
            .array(
              z.object({
                ref: z.number().int().positive().describe('The field\'s number from the last reading'),
                label: z.string().max(300).describe('The question as the form words it'),
                value: z.string().max(5000),
                kind: z.enum(['fact', 'written']),
              }),
            )
            .max(20)
            .optional(),
        },
        async ({ link, answers }) => {
          const url = checkLink(link)
          if (!url) return refuse('That is not a Wellfound posting link.')
          const isOpen = await ctx.chrome.evaluate<boolean>(`!!(${APPLY_DIALOG})`, true)
          if (!isOpen) {
            if (answers?.length) return refuse('The application form is not open. Call wellfound_apply with no answers to open and read it.')
            const posting = await openPosting(ctx, url)
            if (posting.notFound) return refuse('Wellfound says this posting does not exist. Finish with outcome "closed".')
            if (posting.applied) return refuse('Wellfound shows this posting as already applied to. Finish with outcome "already-applied".')
            if (posting.route === 'company-site') return refuse(`This posting applies on the company's site: open_page ${posting.applyUrl} and apply there.`)
            const button = await ctx.chrome.evaluate<Point>(APPLY_BUTTON)
            if (button.none) return refuse('There is no Apply button on this posting. Read the page to see why.')
            await clickPoint(ctx, button)
            if (!(await waitFor(ctx, APPLY_DIALOG, 8000))) return refuse('The application form did not open. Read the page to see why.')
            await sleep(500)
            ctx.log('step', 'Opened the Wellfound application')
            return say(await readPage(ctx, 'auto', 4000))
          }

          const written: WrittenAnswer[] = (answers ?? []).filter(a => a.kind === 'written').map(a => ({ ref: a.ref, label: a.label, text: a.value }))
          const facts = (answers ?? []).filter(a => a.kind === 'fact').map(a => ({ label: a.label, value: a.value }))
          const approved = await approveWritten(ctx, written, facts)
          if (!approved) return refuse('The user chose not to send this application. Leave it unsent and finish with outcome "not-applied".')
          const textOf = new Map(approved.texts.map(answer => [answer.ref, answer.text]))
          const problems: string[] = []
          for (const answer of answers ?? []) {
            try {
              await setField(ctx, answer.ref, answer.kind === 'written' ? (textOf.get(answer.ref) ?? answer.value) : answer.value)
            } catch (error) {
              problems.push(`${answer.label}: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
          if (problems.length) return refuse(`Not sent: some answers could not be filled.\n${problems.join('\n')}\nRead the form again and retry.`)
          ctx.count('filled', (answers ?? []).length)

          const send = await ctx.chrome.evaluate<Point>(SEND_BUTTON)
          if (send.none) return refuse('The Send application button is gone. Read the page.')
          await ctx.chrome.allowSubmit()
          await clickPoint(ctx, send)
          const closed = await waitFor(ctx, `!(${APPLY_DIALOG})`, 12_000)
          if (!closed) return refuse(`Wellfound did not send it. The form shows:\n${await readPage(ctx, 'auto', 3000)}`)
          record.sent = { route: 'wellfound', written: approved.texts, edited: approved.edited, facts, byUser: false }
          ctx.log('good', 'Sent the application on Wellfound')
          return say('Sent: Wellfound closed the form. Finish with outcome "applied".')
        },
        {
          steps: () => ['In Chrome, press Apply on this posting', 'Write your note and answer any questions', 'Press Send application, then come back here and press Continue'],
          afterUser: async () => {
            record.sent = { route: 'wellfound', written: [], edited: false, facts: [], byUser: true }
            return say('The user sent the application themselves. Finish with outcome "applied".')
          },
        },
      ),
    )
  }

  return tools
}
