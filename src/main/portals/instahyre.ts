import { z } from 'zod'

import { readPage } from '../browser/tools'
import type { ApplyRecord } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { clickPoint, isKnown, markSite, portalTool, refuse, say, sleep, stageLine, waitFor } from './common'
import type { OnRead } from './common'

/*
 * Instahyre's own tools, written from its live pages:
 * - /candidate/opportunities/?matching=true lists the jobs Instahyre
 *   recommends for the user's Instahyre profile ("Showing 1 - 20 out of 20
 *   jobs"). It is an AngularJS page: each card is a div.employer-block whose
 *   scope's `opp` holds the job (id, title, locations, keywords,
 *   opportunity_url), the employer (name, employee count) and whether it is a
 *   strong match. "View job" opens a modal; it has no address of its own.
 * - A posting is /job-<id>-<slug>/, and /job-<id>/ redirects there. It has
 *   #company-facts (founded, company size, location, industry),
 *   #job-skills-description and #job-description, and one "Apply now"
 *   button (ng-click submitChoice); its scope's `opp.appliedOn` is set once
 *   applied.
 * - Signed in, the top bar reads "Sign out". Instahyre shows no posting dates
 *   and rarely pay.
 */

const MATCHES_URL = 'https://www.instahyre.com/candidate/opportunities/?matching=true'
export const jobLink = (jobId: string): string => `https://www.instahyre.com/job-${jobId}/`

// The top bar comes first in the page's text, and reads "Sign out" when signed in.
const SIGNED_IN = `/sign out/i.test(document.body.innerText.slice(0, 1500)) && !/\\/login/.test(location.pathname)`

type Match = { jobId: string; title: string; company: string; locations: string; size: string; founded: string; skills: string[]; strong: boolean; url: string; about: string }

const MATCHES_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const ng = window.angular;
  const matches = [];
  for (const block of document.querySelectorAll('div.employer-block')) {
    const scope = ng ? ng.element(block).scope() : null;
    const opp = scope && scope.opp;
    if (!opp || !opp.job) continue;
    const lines = block.innerText.split('\n').map(clean).filter(Boolean);
    let url = '';
    try { url = opp.job.opportunity_url ? new URL(opp.job.opportunity_url, location.href).href : ''; } catch {}
    matches.push({
      jobId: String(opp.job.id),
      title: opp.job.title || opp.job.candidate_title || '',
      company: (opp.employer && opp.employer.company_name) || opp.job.hiring_company_name || '',
      locations: opp.job.locations || '',
      size: lines.find(l => /employees$/i.test(l)) || '',
      founded: lines.find(l => /^Founded in/i.test(l)) || '',
      skills: (opp.job.keywords || []).map(k => typeof k === 'string' ? k : (k && (k.name || k.keyword || k.text)) || '').filter(Boolean).slice(0, 10),
      strong: !!opp.is_strong_match,
      url,
      about: (lines.find(l => l.length > 60) || '').slice(0, 200),
    });
  }
  return {
    showing: clean((document.body.innerText.match(/Showing[^\n]*jobs/i) || [''])[0]),
    matches,
    signedIn: ${SIGNED_IN},
  };
})()`

type Posting = {
  title: string
  company: string
  where: string
  years: string
  facts: string[]
  size: string
  skills: string
  about: string
  canApply: boolean
  applied: boolean
  signedIn: boolean
  notFound: boolean
}

/** Reads a posting whole: every line of the description, never cut short. */
export const JOB_SCRIPT = (): string => String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const t = document.title.replace(/ - Instahyre$/, '');
  const at = t.lastIndexOf(' job at ');
  const title = at > 0 ? t.slice(0, at) : t;
  const company = at > 0 ? t.slice(at + 8) : '';
  const lines = document.body.innerText.split('\n').map(clean).filter(Boolean);
  const atLine = lines.indexOf('at ' + company);
  const facts = ((document.getElementById('company-facts') || {}).innerText || '').split('\n').map(clean).filter(Boolean);
  const sizeAt = facts.findIndex(l => /^Company size$/i.test(l));
  const desc = ((document.getElementById('job-description') || {}).innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  const button = document.querySelector('[ng-click^="submitChoice"]');
  const opp = button && window.angular ? window.angular.element(button).scope().opp : null;
  return {
    title, company,
    where: atLine >= 0 ? lines[atLine + 1] || '' : '',
    years: lines.find(l => /^\d+\s*(-\s*\d+)?\+?\s*Years?$/i.test(l)) || '',
    facts: facts.filter(l => !/at a Glance$/i.test(l)).slice(0, 12),
    size: sizeAt >= 0 ? facts[sizeAt + 1] || '' : '',
    skills: clean((document.getElementById('job-skills-description') || {}).innerText || ''),
    about: desc,
    canApply: !!button && /apply/i.test(button.innerText),
    applied: !!(opp && opp.appliedOn) || (!!button && /applied/i.test(button.innerText)),
    signedIn: ${SIGNED_IN},
    notFound: !document.getElementById('job-description') && /not found|404|no longer/i.test(document.body.innerText.slice(0, 2000)),
  };
})()`

const APPLY_BUTTON = String.raw`(() => {
  const b = document.querySelector('[ng-click^="submitChoice"]');
  if (!b) return { none: true };
  b.scrollIntoView({ block: 'center' });
  const box = b.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, text: b.innerText.trim() };
})()`

/** Whether the posting now shows as applied, or a dialog asking for more opened instead. */
const AFTER_APPLY = String.raw`(() => {
  const shown = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const b = document.querySelector('[ng-click^="submitChoice"]');
  const opp = b && window.angular ? window.angular.element(b).scope().opp : null;
  const applied = !!(opp && opp.appliedOn) || (!!b && /applied/i.test(b.innerText)) || /application (has been )?(sent|submitted)|successfully applied/i.test(document.body.innerText);
  const asks = [...document.querySelectorAll('.modal, [role="dialog"], .application-modal')].filter(shown).some(d => d.querySelector('input:not([type=hidden]), textarea, select'));
  return { applied, asks };
})()`

type Point = { x?: number; y?: number; none?: boolean; text?: string }

async function openPosting(ctx: RunContext, jobId: string): Promise<Posting> {
  await ctx.chrome.openPage(jobLink(jobId))
  await waitFor(ctx, `document.getElementById('job-description') || /\\/login/.test(location.pathname) || /not found/i.test(document.title)`, 10_000)
  await sleep(500)
  const posting = await ctx.chrome.evaluate<Posting>(JOB_SCRIPT())
  markSite(ctx, 'instahyre', posting.signedIn ? 'signed-in' : 'signed-out')
  return posting
}

function formatPosting(posting: Posting, jobId: string): string {
  return [
    `${posting.title} at ${posting.company}`,
    `Job id ${jobId}, link: ${jobLink(jobId)}`,
    posting.where ? `Where: ${posting.where}` : '',
    posting.years ? `Experience: ${posting.years}` : '',
    'Pay: not shown (Instahyre rarely shows it)',
    posting.applied ? 'Already applied on Instahyre.' : posting.canApply ? 'Apply route: on Instahyre, in one step with the Instahyre profile' : 'No Apply button on the page.',
    `About the company: ${posting.facts.join(' | ') || 'not shown'}`,
    stageLine(posting.size),
    posting.skills ? `Skills: ${posting.skills}` : '',
    '',
    'The posting:',
    posting.about,
  ]
    .filter(line => line !== '')
    .join('\n')
}

/**
 * Instahyre's tools for a flow. The hunt gets list_matches and read_job;
 * apply gets read_job and apply, which writes what was sent into `record`.
 */
export function instahyreTools(ctx: RunContext, options: { hunt?: { onSearch: (search: string | null, postings: string[]) => void }; apply?: ApplyRecord; onRead?: OnRead }): AnyTool[] {
  const tools: AnyTool[] = []

  if (options.hunt) {
    const hunt = options.hunt
    tools.push(
      portalTool(
        ctx,
        'instahyre',
        'list_matches',
        'List the jobs Instahyre recommends for the user\'s Instahyre profile. Instahyre shows no posting dates, so every match counts as current. Answers only matches new to the user; the rest are left out and counted. Call it once.',
        {},
        async () => {
          await ctx.chrome.openPage(MATCHES_URL)
          await waitFor(ctx, `document.querySelector('div.employer-block') || /Showing\\s+0|no jobs/i.test(document.body.innerText) || /\\/login/.test(location.pathname)`, 12_000)
          await sleep(800)
          const result = await ctx.chrome.evaluate<{ showing: string; matches: Match[]; signedIn: boolean }>(MATCHES_SCRIPT)
          markSite(ctx, 'instahyre', result.signedIn ? 'signed-in' : 'signed-out')
          if (!result.signedIn) return refuse('Instahyre is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then list again.')
          const fresh = result.matches.filter(match => !isKnown(ctx, 'instahyre', match.jobId, match.company, match.title))
          const left = result.matches.length - fresh.length
          if (left) ctx.count('skipped', left)
          hunt.onSearch('instahyre', fresh.map(match => `instahyre:${match.jobId}`))
          return say(
            [
              `Instahyre: ${result.showing || `${result.matches.length} recommended`}; ${fresh.length} new, ${left} left out as already known.`,
              ...fresh.map(match =>
                [
                  `[${match.jobId}] ${match.title}`,
                  match.company,
                  match.locations,
                  match.size,
                  match.founded,
                  match.strong ? 'strong match' : '',
                  match.skills.length ? `skills: ${match.skills.join(', ')}` : '',
                  match.about,
                ]
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
      'instahyre',
      'read_job',
      'Read one Instahyre posting by its job id: title, company, where, experience asked, whether already applied, the company\'s facts and size with its stage bucket, skills, and the description.',
      { job_id: z.string().regex(/^\d+$/, 'An Instahyre job id is digits only') },
      async ({ job_id }) => {
        const posting = await openPosting(ctx, job_id)
        if (!posting.signedIn) return refuse('Instahyre is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then read the posting again.')
        if (posting.notFound) return refuse('Instahyre has no such posting now: treat it as closed.')
        ctx.count('read')
        if (options.apply) options.apply.posting = { closed: false, route: 'instahyre', applyUrl: null }
        const text = formatPosting(posting, job_id)
        options.onRead?.({ portal: 'instahyre', jobId: job_id, postingLink: jobLink(job_id), route: 'instahyre', applyUrl: null, closed: false, text })
        return say(text)
      },
    ),
  )

  if (options.apply) {
    const record = options.apply
    tools.push(
      portalTool(
        ctx,
        'instahyre',
        'apply',
        'Apply to an Instahyre posting in one step: it sends the user\'s Instahyre profile to the company. There is nothing to write. Answers whether Instahyre shows it as applied.',
        { job_id: z.string().regex(/^\d+$/) },
        async ({ job_id }) => {
          const posting = await openPosting(ctx, job_id)
          if (!posting.signedIn) return refuse('Instahyre is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then apply again.')
          if (posting.notFound) return refuse('Instahyre has no such posting now. Finish with outcome "closed".')
          if (posting.applied) return refuse('Instahyre shows this posting as already applied to. Finish with outcome "already-applied".')
          const button = await ctx.chrome.evaluate<Point>(APPLY_BUTTON)
          if (button.none) return refuse('There is no Apply button on this posting. Read the page to see why.')
          await ctx.chrome.allowSubmit()
          await clickPoint(ctx, button)
          let after = { applied: false, asks: false }
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline && !after.applied && !after.asks) {
            await sleep(600)
            after = await ctx.chrome.evaluate<{ applied: boolean; asks: boolean }>(AFTER_APPLY, true).catch(() => after)
          }
          if (after.applied) {
            record.sent = { route: 'instahyre', written: [], edited: false, facts: [], byUser: false }
            ctx.log('good', 'Applied on Instahyre')
            return say('Applied: Instahyre shows it as applied. Finish with outcome "applied".')
          }
          if (after.asks) return refuse(`Instahyre asks for more before applying:\n${await readPage(ctx, 'auto', 3000)}\nAnswer it from the saved answers with the general tools, or hand it to the user.`)
          return refuse(`Instahyre did not show it as applied. The page now shows:\n${await readPage(ctx, 'auto', 2000)}`)
        },
        {
          steps: () => ['In Chrome, press Apply now on this posting', 'Come back here and press Continue'],
          afterUser: async () => {
            record.sent = { route: 'instahyre', written: [], edited: false, facts: [], byUser: true }
            return say('The user applied themselves. Finish with outcome "applied".')
          },
        },
      ),
    )
  }

  return tools
}
