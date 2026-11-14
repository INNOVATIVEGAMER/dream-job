import { z } from 'zod'

import { HUNT_WINDOW_NAMES } from '../../shared/types'
import type { HuntWindow, WrittenAnswer } from '../../shared/types'
import { approveWritten, readPage, setField } from '../browser/tools'
import type { ApplyRecord } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { clickPoint, markSite, portalTool, refuse, say, sleep, stageLine, waitFor } from './common'
import type { OnRead } from './common'

/*
 * LinkedIn's own tools, written from its live pages:
 * - Search is LinkedIn's AI search at /jobs/search-results/. It reads role,
 *   work mode and place from plain words in `keywords`; `f_TPR` (posted
 *   within) and `start` (paging, 25 a page) still work as URL filters. Each
 *   result card carries componentkey="job-card-component-ref-<job id>".
 * - A posting is /jobs/view/<id>/. Its sections carry componentkeys
 *   JobDetails_AboutTheJob_*, JobDetails_AboutTheCompany_* (industry and
 *   headcount) and JobDetailsPeopleWhoCanHelpSlot_* (the hiring team).
 * - Easy Apply is a button labelled "Easy Apply to this job"; otherwise an
 *   "Apply on company website" link, through LinkedIn's /safety/go/?url=.
 * - The Easy Apply form is a <dialog> titled "Apply to <company>", a page
 *   count ("1/5 pages"), labelled fields, and Next, Review and, last, Submit.
 *   Closing it asks "Save this application?" with Discard and Save.
 * The older layout's data-job-id cards are read too.
 */

const TIME_FILTER: Record<HuntWindow, string> = { day: 'r86400', week: 'r604800', month: 'r2592000' }

export const jobUrl = (jobId: string): string => `https://www.linkedin.com/jobs/view/${jobId}/`

type Card = { jobId: string; title: string; company: string; location: string; pay: string; posted: string; flags: string[]; other: string[] }
type SearchPage = { count: string; cards: Card[]; hasNext: boolean; noResults: boolean; signedOut: boolean }

const CARDS = '[componentkey^="job-card-component-ref-"], [data-occludable-job-id], [data-job-id]'

export const SEARCH_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const cards = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('${CARDS}')) {
    const id = (el.getAttribute('componentkey') || '').replace('job-card-component-ref-', '') || el.getAttribute('data-occludable-job-id') || el.getAttribute('data-job-id') || '';
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const dismiss = el.querySelector('button[aria-label^="Dismiss "]');
    let title = dismiss ? dismiss.getAttribute('aria-label').replace(/^Dismiss /, '').replace(/ job$/, '') : '';
    const lines = el.innerText.split('\n').map(clean).filter(line => line && line !== '·');
    if (!title) title = (lines[0] || '').replace(/^Selected, /, '').replace(/ \(Verified job\)$/, '').replace(/ with verification$/, '');
    const rest = lines.filter(line => !line.startsWith('Selected, ') && !line.endsWith('(Verified job)') && line !== title);
    const pay = rest.find(line => /(\d[\d.,]*\s*[KkMmLl]?\s*(INR|USD|EUR|GBP|CAD|AUD|SGD)|[$€£₹]\s?\d)/.test(line) && /\/(yr|year|mo|month|hr|hour)|\s-\s/i.test(line)) || '';
    const posted = rest.find(line => /^(Posted|Reposted) /.test(line)) || rest.find(line => /\bago$/.test(line)) || '';
    const known = ['Easy Apply', 'Viewed', 'Applied', 'Promoted', 'Actively reviewing applicants', 'Be an early applicant'];
    const flags = known.filter(flag => rest.some(line => line === flag || line.startsWith(flag + ' ')));
    const other = rest.slice(2).filter(line => line !== pay && line !== posted && !known.some(flag => line.startsWith(flag)) && !/^\d+ \w+ ago$/.test(line)).slice(0, 3);
    cards.push({ jobId: id, title, company: rest[0] || '', location: rest[1] || '', pay, posted: posted.replace(/^Posted /, ''), flags, other });
  }
  const header = document.querySelector('[componentkey="searchResultsHeaderComponent"], .jobs-search-results-list__subtitle');
  const main = (document.querySelector('main') || document.body).innerText.slice(0, 3000);
  return {
    count: header ? clean(header.innerText).split(' How ')[0] : '',
    cards,
    hasNext: !!document.querySelector('[data-testid="pagination-controls-next-button-visible"], button[aria-label="View next page"]'),
    noResults: /No matching jobs found|We couldn.t find a match/i.test(main),
    signedOut: /\/(login|authwall|checkpoint|uas)\b/.test(location.pathname) || !!document.querySelector('form.login__form, a[href*="/login"][data-tracking-control-name*="nav-header-signin"]'),
  };
})()`

type Job = {
  title: string
  company: string
  meta: string[]
  tags: string[]
  route: 'easy-apply' | 'company-site' | 'unknown'
  applyUrl: string | null
  applied: string | null
  closed: boolean
  about: string
  companyInfo: { lines: string[]; size: string; link: string }
  hiring: { name: string; headline: string; profile: string }[]
  signedOut: boolean
}

/** Reads a posting whole: every line of the description, never cut short. */
export const JOB_SCRIPT = (): string => String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const section = key => document.querySelector('[componentkey^="' + key + '"]');
  const lines = el => el ? el.innerText.split('\n').map(clean).filter(Boolean) : [];
  const parts = document.title.split(' | ');
  const main = document.querySelector('main') || document.body;
  const top = lines(main).slice(0, 25);
  const title = parts.length >= 3 ? parts[0] : (top[1] || '');
  const company = parts.length >= 3 ? parts[1] : (top[0] || '');
  const metaLine = top.find(line => line.includes(' · ')) || '';
  const after = top.slice(top.indexOf(metaLine) + 1);
  const stop = after.findIndex(line => /^(Easy Apply|Apply|Save|Applied|See application)$/.test(line));
  const tags = after.slice(0, stop < 0 ? 6 : stop).filter(line => line.length < 80);
  const easy = [...main.querySelectorAll('button')].find(b => /^Easy Apply/i.test(b.getAttribute('aria-label') || '') || clean(b.innerText) === 'Easy Apply');
  const external = main.querySelector('a[aria-label*="company website" i]');
  let applyUrl = null;
  if (external) {
    try { const u = new URL(external.href); applyUrl = u.searchParams.get('url') || external.href; } catch { applyUrl = external.href; }
  }
  const text = main.innerText;
  const applied = (text.match(/Applied \d+ \w+ ago|Application submitted[^\n]*/) || [null])[0];
  const aboutEl = section('JobDetails_AboutTheJob_') || document.querySelector('#job-details, .jobs-description__content');
  const about = aboutEl ? aboutEl.innerText.replace(/\n{3,}/g, '\n\n').trim() : '';
  const companyEl = section('JobDetails_AboutTheCompany_') || document.querySelector('.jobs-company__box');
  const companyLines = lines(companyEl).filter(line => line !== '•' && line !== 'Follow' && line !== 'Following' && line !== 'About the company').slice(0, 6);
  const size = companyLines.find(line => /employees$/.test(line)) || '';
  const companyLink = companyEl && companyEl.querySelector('a[href*="/company/"]');
  const people = section('JobDetailsPeopleWhoCanHelpSlot_') || document.querySelector('.job-details-people-who-can-help__section--two-pane, .hirer-card__container');
  const hiring = people ? [...people.querySelectorAll('a[href*="/in/"]')].map(a => {
    const bits = a.innerText.split('\n').map(clean).filter(line => line && !/^• /.test(line) && line !== '•');
    return { name: bits[0] || '', headline: bits.find((line, i) => i > 0 && line.length > 3) || '', profile: new URL(a.href).origin + new URL(a.href).pathname };
  }).filter(p => p.name).slice(0, 3) : [];
  return {
    title, company,
    meta: metaLine ? metaLine.split(' · ').map(clean) : [],
    tags,
    route: easy ? 'easy-apply' : external ? 'company-site' : 'unknown',
    applyUrl,
    applied,
    closed: /No longer accepting applications/i.test(text),
    about,
    companyInfo: { lines: companyLines, size, link: companyLink ? new URL(companyLink.href).origin + new URL(companyLink.href).pathname : '' },
    hiring,
    signedOut: /\/(login|authwall|checkpoint|uas)\b/.test(location.pathname),
  };
})()`

/** The open Easy Apply dialog, as an expression for the page. */
const APPLY_DIALOG = `[...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')].filter(d => { const b = d.getBoundingClientRect(); return b.width > 0 && b.height > 0 }).find(d => /^Apply to /i.test((d.innerText || '').trim()) || d.querySelector('progress'))`

/** Finds a button in the Easy Apply dialog by its words and answers its centre. */
const dialogButtonScript = (pattern: string): string => String.raw`(() => {
  const dialog = ${APPLY_DIALOG};
  if (!dialog) return { error: 'The Easy Apply form is not open.' };
  const words = b => (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const button = [...dialog.querySelectorAll('button')].find(b => new RegExp(${JSON.stringify(pattern)}, 'i').test(words(b)) && !b.disabled);
  if (!button) return { none: true, buttons: [...dialog.querySelectorAll('button')].map(words).filter(Boolean) };
  button.scrollIntoView({ block: 'center' });
  const box = button.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, words: words(button) };
})()`

type Point = { x?: number; y?: number; none?: boolean; error?: string; words?: string; buttons?: string[] }

/** Ticks off "Follow <company>" on the review page: applying should not also follow. */
const UNFOLLOW_SCRIPT = String.raw`(() => {
  const dialog = ${APPLY_DIALOG};
  if (!dialog) return { none: true };
  for (const box of dialog.querySelectorAll('input[type="checkbox"]')) {
    const label = (box.id && dialog.querySelector('label[for="' + CSS.escape(box.id) + '"]')) || box.closest('label');
    if (!label || !/^\s*Follow\b/i.test(label.innerText) || !box.checked) continue;
    label.scrollIntoView({ block: 'center' });
    const b = label.getBoundingClientRect();
    return { x: b.left + Math.min(b.width / 2, 12), y: b.top + b.height / 2 };
  }
  return { none: true };
})()`

const EASY_APPLY_BUTTON = String.raw`(() => {
  const main = document.querySelector('main') || document.body;
  const button = [...main.querySelectorAll('button')].find(b => /^Easy Apply/i.test(b.getAttribute('aria-label') || '') || (b.innerText || '').trim() === 'Easy Apply');
  if (!button) return { none: true };
  button.scrollIntoView({ block: 'center' });
  const box = button.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`

/** Closes the Easy Apply form unsent: Dismiss, then Discard. */
export async function discardEasyApply(ctx: RunContext): Promise<void> {
  const dismiss = await ctx.chrome.evaluate<Point>(dialogButtonScript('^Dismiss$'))
  if (dismiss.error || dismiss.none) return
  await clickPoint(ctx, dismiss)
  const asked = await waitFor(ctx, `[...document.querySelectorAll('dialog[open] button, [role="dialog"] button')].some(b => b.innerText.trim() === 'Discard')`, 4000)
  if (!asked) return
  const discard = await ctx.chrome.evaluate<Point>(String.raw`(() => {
    const b = [...document.querySelectorAll('dialog[open] button, [role="dialog"] button')].find(b => b.innerText.trim() === 'Discard');
    if (!b) return { none: true };
    const box = b.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`)
  if (!discard.none) await clickPoint(ctx, discard)
  await sleep(800)
}

const pageCount = (text: string): { at: number; of: number } | null => {
  const match = text.match(/(\d+)\s*\/\s*(\d+) pages/)
  return match ? { at: Number(match[1]), of: Number(match[2]) } : null
}

async function readForm(ctx: RunContext): Promise<string> {
  const text = await readPage(ctx, 'auto', 5000)
  const pages = pageCount(text)
  if (pages) ctx.progress('Easy Apply pages', pages.at, pages.of)
  return text
}

function formatJob(job: Job, jobId: string): string {
  return [
    `Job ${jobId}: ${job.title}`,
    `Company: ${job.company}`,
    `Link: ${jobUrl(jobId)}`,
    job.meta.length ? `Where, when, applicants: ${job.meta.join(' | ')}` : '',
    job.tags.length ? `Shown with it: ${job.tags.join(' | ')}` : '',
    `Apply route: ${job.route === 'easy-apply' ? 'Easy Apply' : job.route === 'company-site' ? `the company's site: ${job.applyUrl ?? 'link not found'}` : 'not found on the page'}`,
    job.applied ? `Already applied on LinkedIn: ${job.applied}` : '',
    job.closed ? 'CLOSED: LinkedIn says it is no longer accepting applications.' : '',
    `About the company: ${job.companyInfo.lines.join(' | ') || 'not shown'}`,
    stageLine(job.companyInfo.size),
    job.hiring.length ? `Hiring team: ${job.hiring.map(person => `${person.name} (${person.headline}) ${person.profile}`).join('; ')}` : '',
    '',
    'About the job:',
    job.about,
  ]
    .filter(line => line !== '')
    .join('\n')
}

export type HuntHooks = {
  window: HuntWindow
  /** Each search run (null for a later page of one already counted), with the new postings it found as portal:id. */
  onSearch: (search: string | null, postings: string[]) => void
}

/**
 * LinkedIn's tools for a flow. The hunt gets search_jobs and read_job; apply
 * gets read_job and the Easy Apply pair, which write what was sent into
 * `record` for the flow to save.
 */
export function linkedinTools(ctx: RunContext, options: { hunt?: HuntHooks; apply?: ApplyRecord; onRead?: OnRead }): AnyTool[] {
  const tools: AnyTool[] = []
  const { store } = ctx

  if (options.hunt) {
    const hunt = options.hunt
    tools.push(
      portalTool(
        ctx,
        'linkedin',
        'search_jobs',
        `Search LinkedIn jobs posted within ${HUNT_WINDOW_NAMES[hunt.window].toLowerCase()}, for one role, one work mode and one place, 25 a page. Answers only postings that are new to the user: those already tracked, discarded, on never-show or applied to on LinkedIn are left out and counted.`,
        {
          role: z.string().min(2).max(120).describe('A job title, such as one of the target roles'),
          mode: z.enum(['remote', 'hybrid', 'on-site']),
          place: z.string().max(120).describe('A city, or the country for remote'),
          page: z.number().int().min(0).max(4).optional().describe('0 for the first page'),
        },
        async ({ role, mode, place, page }) => {
          const query = `${role.trim()} ${mode} jobs${place.trim() ? ` in ${place.trim()}` : ''}`
          const params = new URLSearchParams({ keywords: query, f_TPR: TIME_FILTER[hunt.window] })
          if (page) params.set('start', String(page * 25))
          await ctx.chrome.openPage(`https://www.linkedin.com/jobs/search-results/?${params.toString()}`)
          await waitFor(ctx, `document.querySelector('${CARDS}') || /No matching jobs/i.test(document.body.innerText)`, 10_000)
          await sleep(800)
          const result = await ctx.chrome.evaluate<SearchPage>(SEARCH_SCRIPT)
          markSite(ctx, 'linkedin', result.signedOut ? 'signed-out' : 'signed-in')
          if (result.signedOut) return refuse('LinkedIn is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then search again.')

          const fresh: Card[] = []
          let left = 0
          for (const card of result.cards) {
            const isOut =
              card.flags.includes('Applied') ||
              store.discarded.has('linkedin', card.jobId) ||
              !!store.opportunities.findExisting('linkedin', card.jobId, card.company, card.title) ||
              !!store.neverShow.match(card.company)
            if (isOut) left++
            else fresh.push(card)
          }
          if (left) ctx.count('skipped', left)
          hunt.onSearch(page ? null : `${role}|${mode}|${place}`.toLowerCase(), fresh.map(card => `linkedin:${card.jobId}`))
          const lines = fresh.map(card =>
            [`[${card.jobId}] ${card.title}`, card.company, card.location, card.pay || 'pay not shown', card.posted, ...card.flags, ...card.other].filter(Boolean).join(' | '),
          )
          return say(
            [
              `Search: "${query}", ${HUNT_WINDOW_NAMES[hunt.window].toLowerCase()}, page ${(page ?? 0) + 1}. LinkedIn shows ${result.count || 'an unknown number of results'}.`,
              result.noResults || result.cards.length === 0 ? 'No results on this page.' : `${fresh.length} new, ${left} left out as already known.`,
              ...lines,
              result.hasNext ? 'More pages: yes.' : 'More pages: no.',
            ].join('\n'),
          )
        },
      ),
    )
  }

  tools.push(
    portalTool(
      ctx,
      'linkedin',
      'read_job',
      'Read one LinkedIn posting by its job id: title, company, place, when posted, applicants, pay if shown, apply route (Easy Apply or the company site with its link), whether it is closed or already applied to, the company\'s industry and headcount with its stage bucket, the hiring team, and the description.',
      { job_id: z.string().regex(/^\d+$/, 'A LinkedIn job id is digits only').describe('The job id from search_jobs or the row') },
      async ({ job_id }) => {
        await ctx.chrome.openPage(jobUrl(job_id))
        await waitFor(ctx, `document.querySelector('[componentkey^="JobDetails_AboutTheJob_"], #job-details, .jobs-description__content') || /No longer accepting|This job is no longer available|Page not found/i.test(document.body.innerText)`, 10_000)
        const job = await ctx.chrome.evaluate<Job>(JOB_SCRIPT())
        markSite(ctx, 'linkedin', job.signedOut ? 'signed-out' : 'signed-in')
        if (job.signedOut) return refuse('LinkedIn is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then read the posting again.')
        ctx.count('read')
        if (options.apply) options.apply.posting = { closed: job.closed, route: job.route, applyUrl: job.applyUrl }
        const text = formatJob(job, job_id)
        options.onRead?.({ portal: 'linkedin', jobId: job_id, postingLink: jobUrl(job_id), route: job.route, applyUrl: job.applyUrl, closed: job.closed, text })
        return say(text)
      },
    ),
  )

  if (options.apply) {
    const record = options.apply
    tools.push(
      portalTool(
        ctx,
        'linkedin',
        'easy_apply_fill',
        [
          'Work the Easy Apply form, one page at a time. Called with no values, it opens the form on the posting (if it is not open) and reads the page: its fields come numbered.',
          'Called with values, it sets each field by its number, then by default presses Next or Review and reads the page that follows, with any error LinkedIn shows.',
          'Mark each value "fact" (from the profile or saved answers: names, numbers, yes or no, a choice) or "written" (free text you composed in the user\'s voice). Written values are shown to the user first, who may edit them or decline; declining closes the form unsent.',
          'For a radio, give the number of the option to pick; for a checkbox, "checked" or "unchecked"; for a type-ahead field, the text, and the closest suggestion is picked. It never presses Submit: use linkedin_easy_apply_submit on the review page.',
        ].join(' '),
        {
          job_id: z.string().regex(/^\d+$/).describe('The posting\'s job id'),
          values: z
            .array(
              z.object({
                ref: z.number().int().positive().describe('The field\'s number from the last reading'),
                label: z.string().max(300).describe('The question as the form words it'),
                value: z.string().max(5000),
                kind: z.enum(['fact', 'written']),
              }),
            )
            .max(30)
            .optional(),
          then: z
            .enum(['next', 'stay'])
            .optional()
            .describe('"next" presses Next or Review; "stay" stays on this page. By default it moves on after filling values, and only reads when given none'),
        },
        async ({ job_id, values, then }) => {
          const isOpen = await ctx.chrome.evaluate<boolean>(`!!(${APPLY_DIALOG})`, true)
          if (!isOpen) {
            if (values?.length) return refuse('The Easy Apply form is not open. Call linkedin_easy_apply_fill with no values to open it and read its fields.')
            const here = await ctx.chrome.page()
            if (!here.url.includes(`/jobs/view/${job_id}`)) {
              await ctx.chrome.openPage(jobUrl(job_id))
              await waitFor(ctx, `document.querySelector('main button')`, 8000)
            }
            const button = await ctx.chrome.evaluate<Point>(EASY_APPLY_BUTTON)
            if (button.none) return refuse('This posting has no Easy Apply button. linkedin_read_job gives its apply route: on the company\'s site, use open_page with that link.')
            await clickPoint(ctx, button)
            if (!(await waitFor(ctx, APPLY_DIALOG, 8000))) return refuse('Easy Apply did not open. Read the page to see why.')
            await sleep(600)
            ctx.log('step', 'Opened Easy Apply')
            return say(await readForm(ctx))
          }

          const done: string[] = []
          if (values?.length) {
            const written: WrittenAnswer[] = values.filter(v => v.kind === 'written').map(v => ({ ref: v.ref, label: v.label, text: v.value }))
            const facts = values.filter(v => v.kind === 'fact').map(v => ({ label: v.label, value: v.value }))
            const approved = await approveWritten(ctx, written, facts, true)
            if (!approved) {
              await discardEasyApply(ctx)
              return refuse('The user chose not to send this application, and the form was closed unsent. Finish with outcome "not-applied".')
            }
            const textOf = new Map(approved.texts.map(answer => [answer.ref, answer.text]))
            for (const value of values) {
              const text = value.kind === 'written' ? (textOf.get(value.ref) ?? value.value) : value.value
              try {
                done.push(await setField(ctx, value.ref, text))
              } catch (error) {
                done.push(`could not set ${value.ref} (${value.label}): ${error instanceof Error ? error.message : String(error)}`)
              }
            }
            record.written.push(...approved.texts)
            record.edited ||= approved.edited
            record.facts.push(...facts)
            ctx.count('filled', values.length)
          }

          // With values it moves on unless told to stay; with none it only reads, unless told to move on.
          if ((then ?? (values?.length ? 'next' : 'stay')) === 'next') {
            const step = await ctx.chrome.evaluate<Point>(dialogButtonScript('^(Next|Review|Continue)\\b'))
            if (step.none) {
              const submit = await ctx.chrome.evaluate<Point>(dialogButtonScript('^Submit'))
              const note = submit.none ? `No Next or Review button here. Buttons: ${(step.buttons ?? []).join(', ')}.` : 'This is the review page: check it, then call linkedin_easy_apply_submit.'
              return say([...done, note, '', await readForm(ctx)].join('\n'))
            }
            const before = await ctx.chrome.evaluate<string>(`(${APPLY_DIALOG})?.innerText || ''`, true)
            await clickPoint(ctx, step)
            await waitFor(ctx, `((${APPLY_DIALOG})?.innerText || '') !== ${JSON.stringify(before)}`, 5000)
            await sleep(500)
            done.push(`pressed ${step.words}`)
          }
          return say([...done, '', await readForm(ctx)].join('\n'))
        },
        {
          steps: () => [
            'In Chrome, press Easy Apply on this posting',
            'Fill each page and stop on the review page, before Submit',
            'Come back here and press Continue',
          ],
          afterUser: async () => say('The user filled the Easy Apply form in Chrome and stopped on the review page. Call linkedin_easy_apply_submit next.'),
        },
      ),
      portalTool(
        ctx,
        'linkedin',
        'easy_apply_submit',
        'On the Easy Apply review page, send the application: unticks "Follow" the company, presses Submit application, and confirms LinkedIn sent it. Call only after every page is filled.',
        { job_id: z.string().regex(/^\d+$/).describe('The posting\'s job id') },
        async () => {
          const submit = await ctx.chrome.evaluate<Point>(dialogButtonScript('^Submit'))
          if (submit.error) return refuse('The Easy Apply form is not open.')
          if (submit.none) return refuse('There is no Submit button on this page yet. Fill it and move on with linkedin_easy_apply_fill until the review page.')
          const follow = await ctx.chrome.evaluate<Point>(UNFOLLOW_SCRIPT)
          if (!follow.none) {
            await clickPoint(ctx, follow)
            await sleep(300)
          }
          const again = await ctx.chrome.evaluate<Point>(dialogButtonScript('^Submit'))
          await ctx.chrome.allowSubmit()
          await clickPoint(ctx, again.none ? submit : again)
          const sent = await waitFor(ctx, '/application (was )?sent|application submitted/i.test(document.body.innerText)', 12_000)
          if (!sent) {
            return refuse(`LinkedIn did not confirm the application. What the form shows now:\n${await readPage(ctx, 'auto', 3000)}`)
          }
          record.sent = { route: 'easy-apply', written: record.written, edited: record.edited, facts: record.facts, byUser: false }
          ctx.log('good', 'LinkedIn says the application was sent')
          return say('Sent: LinkedIn confirmed the application. Finish with outcome "applied".')
        },
        {
          steps: () => ['Check the review page of the Easy Apply form in Chrome', 'Press Submit application', 'Come back here and press Continue'],
          afterUser: async () => {
            record.sent = { route: 'easy-apply', written: record.written, edited: record.edited, facts: record.facts, byUser: true }
            return say('The user submitted the application themselves. Finish with outcome "applied".')
          },
        },
      ),
    )
  }

  return tools
}
