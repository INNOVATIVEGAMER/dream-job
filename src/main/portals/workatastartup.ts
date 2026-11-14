import { z } from 'zod'

import type { ApplyRecord } from '../browser/tools'
import { readPage } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { clickPoint, isKnown, markSite, portalTool, refuse, say, SCROLL_TO_END, sleep, stageLine, waitFor } from './common'
import type { OnRead } from './common'

/*
 * Work at a Startup's own tools, written from its live pages (signed in with
 * a YC account):
 * - /companies takes its filters in the URL: role=eng, remote=only,
 *   sortBy=created_desc (newest jobs first), layout=list-compact. Results
 *   load in the page after it opens, grouped by company: each job links to
 *   /jobs/<id> with a line such as "San Francisco, CA, US · Fulltime · Will
 *   Sponsor · $175K - $235K · 3+ Years". Postings show no dates.
 * - A posting /jobs/<id> carries its data in the page (data-page): job
 *   (title, location, jobType, minExperience such as "3+ years",
 *   salaryRange, sponsorsVisa, descriptionHtml), company (name, batch,
 *   teamSize, industry, location), appliedJobIds, appliedToCompany,
 *   locationEligible, customQuestions, and navBar.currentUser when signed
 *   in. Its applyUrl points at YC's /authenticate hop either way.
 * - Apply opens a form on the page: a message to the founders and the
 *   company's own questions. Those are written answers: they wait for the
 *   user, through submit_form.
 */

const BASE = 'https://www.workatastartup.com'
export const jobLink = (jobId: string): string => `${BASE}/jobs/${jobId}`

type Row = { jobId: string; title: string; company: string; details: string }

const ROWS_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const rows = new Map();
  for (const a of document.querySelectorAll('a[href*="/jobs/"]')) {
    const m = /\/jobs\/(\d+)$/.exec(new URL(a.href).pathname);
    if (!m) continue;
    const text = clean(a.innerText);
    let row = a;
    for (let i = 0; i < 5 && row; i++) { row = row.parentElement; if (row && /·/.test(row.innerText)) break; }
    let block = row;
    for (let i = 0; i < 8 && block; i++) { block = block.parentElement; if (block && block.querySelector('a[href^="/companies/"]')) break; }
    // The company from any of its links' address, then its name from the link that shows it ("See all 17 jobs" points there too).
    const anyLink = block && block.querySelector('a[href^="/companies/"]');
    const slug = anyLink ? new URL(anyLink.href).pathname.split('/')[2] || '' : '';
    const nameLink = slug ? [...document.querySelectorAll('a[href^="/companies/"]')].find(l => new URL(l.href).pathname === '/companies/' + slug && clean(l.innerText) && !/^see all/i.test(clean(l.innerText))) : null;
    const known = rows.get(m[1]) || { jobId: m[1], title: '', company: '', details: '' };
    if (text && !/^view job$/i.test(text)) known.title = text;
    known.company = known.company || (nameLink ? clean(nameLink.innerText.split('\n')[0]).replace(/\s*\(.+$/, '') : slug);
    known.details = known.details || clean(row && row.innerText).replace(known.title, '').replace(/View job/i, '').replace(/Job match/i, '').trim();
    rows.set(m[1], known);
  }
  const showing = clean((document.body.innerText.match(/Showing [\d,]+ matching startups/) || [''])[0]);
  return { rows: [...rows.values()].filter(r => r.title), showing };
})()`

type Posting = {
  found: boolean
  signedIn: boolean
  title: string
  location: string
  jobType: string
  minExperience: string
  salary: string
  visa: string
  company: string
  batch: string
  teamSize: number | null
  industry: string
  about: string
  hiring: string
  applied: boolean
  appliedToCompany: boolean
  eligible: boolean | null
  questions: number
}

/** Reads a posting whole from the data the page carries. */
const JOB_SCRIPT = String.raw`(() => {
  const el = document.querySelector('[data-page]');
  let p = null;
  try { p = JSON.parse(el.dataset.page).props; } catch {}
  // Signed in: the page names the current user. (Apply points at /authenticate either way: YC's own sign-in hop.)
  const signedIn = !!(p && ((p.navBar && p.navBar.currentUser) || (p.nav && p.nav.currentUser)));
  if (!p || !p.job) return { found: false, signedIn };
  const text = html => { const d = document.createElement('div'); d.innerHTML = (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '$&- ').replace(/<\/(p|li|h[1-6]|div|ul|ol|tr)>/gi, '$&\n'); return (d.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); };
  const job = p.job, company = p.company || {};
  return {
    found: true,
    signedIn,
    title: job.title || '',
    location: job.location || '',
    jobType: job.jobType || '',
    minExperience: job.minExperience || '',
    salary: job.salaryRange || '',
    visa: job.sponsorsVisa || '',
    company: company.name || '',
    batch: company.batch || '',
    teamSize: typeof company.teamSize === 'number' ? company.teamSize : null,
    industry: company.industry || '',
    about: text(job.descriptionHtml),
    hiring: text(company.hiringDescriptionHtml).slice(0, 1500),
    applied: Array.isArray(p.appliedJobIds) && p.appliedJobIds.includes(job.id),
    appliedToCompany: !!p.appliedToCompany,
    eligible: typeof p.locationEligible === 'boolean' ? p.locationEligible : null,
    questions: Array.isArray(p.customQuestions) ? p.customQuestions.length : 0,
  };
})()`

const APPLY_BUTTON = String.raw`(() => {
  const b = [...document.querySelectorAll('a, button')].find(e => /^apply$/i.test((e.innerText || '').trim()));
  if (!b) return { none: true };
  b.scrollIntoView({ block: 'center' });
  const box = b.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`

async function openPosting(ctx: RunContext, jobId: string): Promise<Posting> {
  await ctx.chrome.openPage(jobLink(jobId))
  await waitFor(ctx, `document.querySelector('[data-page]')`, 10_000)
  const posting = await ctx.chrome.evaluate<Posting>(JOB_SCRIPT)
  markSite(ctx, 'workatastartup', posting.signedIn ? 'signed-in' : 'signed-out')
  return posting
}

function formatPosting(posting: Posting, jobId: string): string {
  return [
    `${posting.title} at ${posting.company}${posting.batch ? ` (YC ${posting.batch})` : ''}`,
    `Job id ${jobId}, link: ${jobLink(jobId)}`,
    `Location: ${posting.location || 'not stated'}`,
    posting.jobType ? `Job type: ${posting.jobType}` : '',
    `Experience: ${posting.minExperience || 'not stated'}`,
    `Salary: ${posting.salary || 'not shown'}`,
    posting.visa ? `Visa: ${posting.visa}` : '',
    posting.eligible === false ? 'Work at a Startup says the user\'s location is not eligible for this role.' : '',
    posting.applied ? 'Already applied on Work at a Startup.' : posting.appliedToCompany ? 'The user has applied to another role at this company.' : 'Apply route: on Work at a Startup, a form with a message to the founders',
    posting.questions ? `The application asks ${posting.questions} questions of its own.` : '',
    `About the company: ${[posting.industry, posting.teamSize !== null ? `${posting.teamSize} people` : ''].filter(Boolean).join(', ') || 'not shown'}`,
    stageLine(posting.teamSize !== null ? `${posting.teamSize} employees` : ''),
    '',
    'The posting:',
    posting.about,
    posting.hiring ? `\nWho they hire:\n${posting.hiring}` : '',
  ]
    .filter(line => line !== '')
    .join('\n')
}

/**
 * Work at a Startup's tools for a flow. The hunt gets search_jobs and
 * read_job; apply gets read_job and open_apply, then fills the form with the
 * general tools and sends it with submit_form.
 */
export function workatastartupTools(ctx: RunContext, options: { hunt?: { onSearch: (search: string | null, postings: string[]) => void }; apply?: ApplyRecord; onRead?: OnRead }): AnyTool[] {
  const tools: AnyTool[] = []

  if (options.hunt) {
    const hunt = options.hunt
    tools.push(
      portalTool(
        ctx,
        'workatastartup',
        'search_jobs',
        'List engineering jobs at YC startups, newest first. Postings show no dates, so it answers the newest few dozen. Answers new postings only; ones the user has seen are left out and counted. Call it once per kind.',
        { remote_only: z.boolean().describe('true: remote roles only; false: every engineering role') },
        async ({ remote_only }) => {
          const url = `${BASE}/companies?role=eng&sortBy=created_desc&layout=list-compact${remote_only ? '&remote=only' : ''}`
          await ctx.chrome.openPage(url)
          await waitFor(ctx, `document.querySelector('a[href*="/jobs/"]') || /Showing 0 matching/.test(document.body.innerText)`, 15_000)
          await sleep(1000)
          let read = await ctx.chrome.evaluate<{ rows: Row[]; showing: string }>(ROWS_SCRIPT)
          // Scroll once or twice for more of the newest.
          for (let i = 0; i < 2 && read.rows.length < 40; i++) {
            await ctx.chrome.evaluate(SCROLL_TO_END, true)
            await sleep(1500)
            read = await ctx.chrome.evaluate<{ rows: Row[]; showing: string }>(ROWS_SCRIPT)
          }
          const fresh = read.rows.filter(row => !isKnown(ctx, 'workatastartup', row.jobId, row.company, row.title))
          const left = read.rows.length - fresh.length
          if (left) ctx.count('skipped', left)
          hunt.onSearch(`workatastartup:${remote_only}`, fresh.map(row => `workatastartup:${row.jobId}`))
          return say(
            [
              `Work at a Startup ${remote_only ? 'remote' : 'all'}: ${read.showing || `${read.rows.length} jobs`}; ${fresh.length} new, ${left} already known.`,
              ...fresh.map(row => [`[${row.jobId}] ${row.title}`, row.company, row.details].filter(Boolean).join(' | ')),
            ].join('\n'),
          )
        },
      ),
    )
  }

  tools.push(
    portalTool(
      ctx,
      'workatastartup',
      'read_job',
      'Read one Work at a Startup posting by its job id: location, job type, experience asked, salary, visa, the company and its size with its stage bucket, whether the user applied, and the description.',
      { job_id: z.string().regex(/^\d+$/, 'A Work at a Startup job id is digits only') },
      async ({ job_id }) => {
        const posting = await openPosting(ctx, job_id)
        if (!posting.found) return refuse(posting.signedIn ? 'Work at a Startup has no such posting now: treat it as closed.' : 'Work at a Startup is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then read the posting again.')
        if (!posting.signedIn) return refuse('Work at a Startup is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then read the posting again.')
        ctx.count('read')
        if (options.apply) options.apply.posting = { closed: false, route: 'workatastartup', applyUrl: null }
        const text = formatPosting(posting, job_id)
        options.onRead?.({ portal: 'workatastartup', jobId: job_id, postingLink: jobLink(job_id), route: 'workatastartup', applyUrl: null, closed: false, text })
        return say(text)
      },
    ),
  )

  if (options.apply) {
    tools.push(
      portalTool(
        ctx,
        'workatastartup',
        'open_apply',
        "Open a posting's Apply form and read it: the message to the founders and the company's own questions, numbered. Fill it with type_text and choose_option, then send it with submit_form, which shows the user every written answer first.",
        { job_id: z.string().regex(/^\d+$/) },
        async ({ job_id }) => {
          const posting = await openPosting(ctx, job_id)
          if (!posting.found) return refuse('Work at a Startup has no such posting now. Finish with outcome "closed".')
          if (!posting.signedIn) return refuse('Work at a Startup is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then open the form again.')
          if (posting.applied) return refuse('Work at a Startup shows this posting as already applied to. Finish with outcome "already-applied".')
          const button = await ctx.chrome.evaluate<{ x?: number; y?: number; none?: boolean }>(APPLY_BUTTON)
          if (button.none) return refuse('There is no Apply button on this posting. Read the page to see why.')
          await clickPoint(ctx, button)
          const opened = await waitFor(ctx, `[...document.querySelectorAll('[role="dialog"], .modal, form')].some(d => d.querySelector('textarea'))`, 8000)
          if (!opened) return refuse(`The Apply form did not open. The page now shows:\n${await readPage(ctx, 'auto', 2000)}`)
          return say(`The Apply form is open:\n${await readPage(ctx, 'auto')}`)
        },
        {
          steps: () => ['In Chrome, press Apply on this posting, write to the founders and answer their questions', 'Send it, then come back here and press Continue'],
          afterUser: async () => {
            if (options.apply) options.apply.sent = { route: 'workatastartup', written: [], edited: false, facts: [], byUser: true }
            return say('The user applied themselves. Finish with outcome "applied".')
          },
        },
      ),
    )
  }

  return tools
}
