import { z } from 'zod'

import type { HuntWindow } from '../../shared/types'
import type { ApplyRecord } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { isKnown, markSite, portalTool, refuse, say, SCROLL_TO_END, sleep, waitFor } from './common'
import type { OnRead } from './common'

/*
 * Weekday's own tools, written from its live pages (signed in):
 * - jobs.weekday.works lists jobs by the filters saved on the user's Weekday
 *   account (role, seniority, places), in two tabs: "Fast Apply" (jobs the
 *   user can apply to on Weekday) and "All openings". Each card links to
 *   jobs.weekday.works/<slug> and shows its age ("a month ago"), title,
 *   company, years asked and place.
 * - A posting carries its data in the page (__NEXT_DATA__ jobDetails):
 *   jobTitle, companyName, minimumExperience (years, a number),
 *   locationList, employmentType, addedOn, isAcceptingApplications,
 *   alreadyApplied, isExternalJob, careersPageLink, directJobLink,
 *   isFastApply, mustHaveSkills, plus a JobPosting record with the
 *   description.
 * - A Weekday job applies on Weekday; an external one on the company's page.
 *   Weekday's Apply can send in one press, so the app hands that press to the
 *   user and checks the posting shows as applied after.
 */

const BASE = 'https://jobs.weekday.works'

/** The posting's address from its link or slug. */
function postingUrl(link: string): string | null {
  try {
    const url = new URL(link.startsWith('http') ? link : `${BASE}/${link.replace(/^\//, '')}`)
    if (url.hostname !== 'jobs.weekday.works' || !/^\/[^/]+$/.test(url.pathname) || url.pathname === '/') return null
    return BASE + url.pathname
  } catch {
    return null
  }
}

type Card = { link: string; title: string; company: string; lines: string[]; age: string }

const CARDS_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const seen = new Set();
  const cards = [];
  for (const a of document.querySelectorAll('a[href]')) {
    let url;
    try { url = new URL(a.href); } catch { continue; }
    if (url.hostname !== 'jobs.weekday.works' || !/^\/[^/]+$/.test(url.pathname) || url.pathname === '/' || seen.has(url.pathname)) continue;
    let box = a;
    for (let i = 0; i < 6 && box; i++) { box = box.parentElement; if (box && /\bago\b|yrs?\b/i.test(box.innerText) && box.innerText.length > 40) break; }
    const lines = (box ? box.innerText : a.innerText).split('\n').map(clean).filter(Boolean);
    if (lines.length < 2) continue;
    seen.add(url.pathname);
    const age = lines.find(l => /\bago$|^today$|^yesterday$/i.test(l)) || '';
    const rest = lines.filter(l => l !== age && l.length > 2 && !/^view more$/i.test(l));
    cards.push({ link: url.pathname, title: rest[0] || '', company: rest[1] || '', lines: rest.slice(2, 7).filter(l => l.length < 80), age });
  }
  const text = document.body.innerText;
  return { cards, signedIn: /Applied & saved|Edit profile/i.test(text) };
})()`

type Posting = {
  found: boolean
  title: string
  company: string
  years: number | null
  places: string
  employment: string
  added: string
  accepting: boolean
  applied: boolean
  external: boolean
  externalUrl: string | null
  fastApply: boolean
  skills: string
  about: string
  signedIn: boolean
  jdUid: string
}

/** Reads a posting whole from the data the page carries. */
const JOB_SCRIPT = String.raw`(() => {
  let d = null;
  try { d = JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps.jobDetails; } catch {}
  // Signed in, the header names the user and asks no one to log in or sign up.
  const signedIn = /Applied & saved|Edit profile/i.test(document.body.innerText) || !/\b(log ?in|sign ?up|sign ?in)\b/i.test(document.body.innerText);
  if (!d) return { found: false, signedIn };
  let ld = null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { const j = JSON.parse(s.textContent); if (j['@type'] === 'JobPosting') ld = j; } catch {} }
  const text = html => { const d = document.createElement('div'); d.innerHTML = (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '$&- ').replace(/<\/(p|li|h[1-6]|div|ul|ol|tr)>/gi, '$&\n'); return (d.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); };
  const places = (d.locationList || []).map(l => typeof l === 'string' ? l : (l && (l.name || l.city || l.location)) || '').filter(Boolean).join(', ');
  const link = [d.careersPageLink, d.directJobLink].find(u => typeof u === 'string' && /^https?:/.test(u) && !/weekday\.works/.test(u)) || null;
  const skills = [].concat(d.mustHaveSkills || [], d.goodToHaveSkills || []).map(s => typeof s === 'string' ? s : (s && (s.name || s.skill)) || '').filter(Boolean).join(', ');
  return {
    found: true,
    title: d.jobTitle || '',
    company: d.companyName || '',
    years: typeof d.minimumExperience === 'number' ? d.minimumExperience : null,
    places,
    employment: d.employmentType || '',
    added: d.addedOn || '',
    accepting: d.isAcceptingApplications !== false,
    applied: !!d.alreadyApplied,
    external: !!d.isExternalJob,
    externalUrl: link,
    fastApply: !!d.isFastApply,
    skills,
    about: text((ld && ld.description) || d.aboutRole),
    signedIn,
    jdUid: String(d.jdUid || ''),
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

async function openPosting(ctx: RunContext, url: string): Promise<Posting> {
  await ctx.chrome.openPage(url)
  await waitFor(ctx, `document.getElementById('__NEXT_DATA__')`, 10_000)
  await sleep(500)
  const posting = await ctx.chrome.evaluate<Posting>(JOB_SCRIPT)
  markSite(ctx, 'weekday', posting.signedIn ? 'signed-in' : 'signed-out')
  return posting
}

function formatPosting(posting: Posting, url: string): string {
  return [
    `${posting.title} at ${posting.company}`,
    `Job id ${posting.jdUid}, link: ${url}`,
    `Where: ${posting.places || 'not stated'}`,
    posting.years !== null ? `Experience asked: ${posting.years}+ yrs (Weekday's job record)` : 'Experience asked: not stated',
    posting.employment ? `Employment: ${posting.employment}` : '',
    posting.added ? `Posted: ${posting.added.slice(0, 10)}` : '',
    'Pay: not shown',
    !posting.accepting ? 'Weekday says it is no longer accepting applications.' : '',
    posting.applied
      ? 'Already applied on Weekday.'
      : posting.external
        ? `Apply route: the company's site: ${posting.externalUrl ?? 'link not given'}`
        : 'Apply route: on Weekday',
    posting.skills ? `Skills: ${posting.skills}` : '',
    '',
    'The posting:',
    posting.about,
  ]
    .filter(line => line !== '')
    .join('\n')
}

/**
 * Weekday's tools for a flow. The hunt gets search_jobs and read_job; apply
 * gets read_job and apply, which hands the Apply press to the user.
 */
export function weekdayTools(ctx: RunContext, options: { hunt?: { window: HuntWindow; onSearch: (search: string | null, postings: string[]) => void }; apply?: ApplyRecord; onRead?: OnRead }): AnyTool[] {
  const tools: AnyTool[] = []

  if (options.hunt) {
    const hunt = options.hunt
    tools.push(
      portalTool(
        ctx,
        'weekday',
        'search_jobs',
        'List Weekday jobs from the filters saved on the user\'s Weekday account, newest within the hunt window. "fast-apply" lists the ones the user can apply to on Weekday; "all" every opening. Answers new postings only. Call it once per list.',
        { list: z.enum(['fast-apply', 'all']) },
        async ({ list }) => {
          await ctx.chrome.openPage(`${BASE}/`)
          await waitFor(ctx, `/Fast Apply|All openings|Sign in|Log in/i.test(document.body.innerText)`, 15_000)
          const tab = list === 'fast-apply' ? 'Fast Apply' : 'All openings'
          await ctx.chrome.evaluate(
            `(() => { const t = [...document.querySelectorAll('button, a, [role=tab], div')].find(e => e.children.length <= 3 && (e.innerText || '').trim().startsWith(${JSON.stringify(tab)})); if (t) t.click(); return !!t; })()`,
            true,
          )
          await sleep(2000)
          let read = await ctx.chrome.evaluate<{ cards: Card[]; signedIn: boolean }>(CARDS_SCRIPT)
          markSite(ctx, 'weekday', read.signedIn ? 'signed-in' : 'signed-out')
          if (!read.signedIn) return refuse('Weekday is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then list again.')
          const limit = WINDOW_DAYS[hunt.window]
          for (let i = 0; i < 4; i++) {
            const last = read.cards[read.cards.length - 1]
            if (!last || (ageInDays(last.age) ?? 0) > limit) break
            const before = read.cards.length
            await ctx.chrome.evaluate(SCROLL_TO_END, true)
            await sleep(1500)
            read = await ctx.chrome.evaluate<{ cards: Card[]; signedIn: boolean }>(CARDS_SCRIPT)
            if (read.cards.length === before) break
          }
          const inWindow = read.cards.filter(card => (ageInDays(card.age) ?? 0) <= limit)
          const fresh = inWindow.filter(card => !isKnown(ctx, 'weekday', card.link, card.company, card.title))
          const left = inWindow.length - fresh.length
          if (left) ctx.count('skipped', left)
          hunt.onSearch(`weekday:${list}`, fresh.map(card => `weekday:${card.link}`))
          return say(
            [
              `Weekday ${tab}: ${read.cards.length} listed, ${inWindow.length} inside the window, ${fresh.length} new, ${left} already known.`,
              ...fresh.map(card => [card.title, card.company, ...card.lines, card.age, `link ${BASE}${card.link}`].filter(Boolean).join(' | ')),
            ].join('\n'),
          )
        },
      ),
    )
  }

  tools.push(
    portalTool(
      ctx,
      'weekday',
      'read_job',
      'Read one Weekday posting by its link (jobs.weekday.works/<slug>): place, years asked, when posted, skills, the description, whether it still accepts applications, whether the user applied, and whether it applies on Weekday or the company\'s site.',
      { link: z.string().max(300).describe('The posting\'s link from search_jobs') },
      async ({ link }) => {
        const url = postingUrl(link)
        if (!url) return refuse('That is not a Weekday posting link. It looks like jobs.weekday.works/<slug>.')
        const posting = await openPosting(ctx, url)
        if (!posting.signedIn) return refuse('Weekday is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then read the posting again.')
        if (!posting.found) return refuse('Weekday shows no such posting now: treat it as closed.')
        ctx.count('read')
        const route = posting.external ? 'company-site' : 'weekday'
        if (options.apply) options.apply.posting = { closed: !posting.accepting, route, applyUrl: posting.externalUrl }
        const text = formatPosting(posting, url)
        options.onRead?.({ portal: 'weekday', jobId: posting.jdUid, postingLink: url, route, applyUrl: posting.external ? posting.externalUrl : null, closed: !posting.accepting, text })
        return say(text)
      },
    ),
  )

  if (options.apply) {
    const record = options.apply
    tools.push(
      portalTool(
        ctx,
        'weekday',
        'apply',
        "Apply to a Weekday job on Weekday. Weekday can send in a single press, so this hands that press to the user in Chrome, then checks the posting shows as applied. A job that applies on the company's site is applied to there instead.",
        { link: z.string().max(300) },
        async ({ link }) => {
          const url = postingUrl(link)
          if (!url) return refuse('That is not a Weekday posting link.')
          const posting = await openPosting(ctx, url)
          if (!posting.found || !posting.accepting) return refuse('Weekday says this posting no longer takes applications. Finish with outcome "closed".')
          if (posting.applied) return refuse('Weekday shows this posting as already applied to. Finish with outcome "already-applied".')
          if (posting.external) return refuse(`This job applies on the company's site: open_page ${posting.externalUrl ?? 'its link from read_job'} and apply there.`)
          await ctx.chrome.bringToFront()
          ctx.log('warn', 'Handing the Weekday Apply press to you')
          const reply = await ctx.ask({ kind: 'handover', reason: 'Press Apply on this Weekday posting in Chrome and answer anything it asks, then come back and press Continue.', what: 'other' })
          if (reply.kind !== 'resume') return refuse('The user stopped the run. Finish now without doing anything more.')
          const after = await openPosting(ctx, url)
          if (!after.applied) return refuse('Weekday does not show this posting as applied. Read the page to see what happened, or finish with outcome "not-applied".')
          record.sent = { route: 'weekday', written: [], edited: false, facts: [], byUser: true }
          ctx.log('good', 'Applied on Weekday')
          return say('Applied: Weekday shows it as applied. Finish with outcome "applied".')
        },
      ),
    )
  }

  return tools
}
