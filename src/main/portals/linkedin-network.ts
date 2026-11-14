import { basename } from 'node:path'

import { z } from 'zod'

import { fillTemplate, firstName } from '../../shared/referral'
import type { Company } from '../../shared/types'
import { namedResume, say } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { clickPoint, markSite, portalTool, refuse, SCROLL_TO_END, sleep, waitFor } from './common'

/*
 * LinkedIn's network tools, written from its live pages:
 * - A company's people are at /company/<slug>/people/?keywords=<words>: one
 *   <li> per person (name, degree, headline, mutual connections) with a
 *   button labelled "Invite <name> to connect", "Follow <name>" (Connect sits
 *   under More) or Message; "Show more results" loads more.
 * - Connect is a link to /preload/custom-invite/?vanityName=<vanity>, which
 *   opens "Add a note to your invitation?" with Dismiss, Add a note and Send
 *   without a note. The app only ever presses Send without a note.
 * - /mynetwork/invite-connect/connections/ lists connections newest first,
 *   each with "Connected on <date>".
 * - A profile's Message is a link to /messaging/compose/. The message box
 *   opens in an open shadow root (#interop-outlet): a contenteditable
 *   .msg-form__contenteditable, a hidden file input that takes PDFs, and Send.
 */

const SIGNED_OUT = `/\\/(login|authwall|checkpoint|uas)\\b/.test(location.pathname)`

/** The message overlay's root: LinkedIn draws it in a shadow root, or in the page on the older layout. */
const ROOT = `((document.querySelector('#interop-outlet') && document.querySelector('#interop-outlet').shadowRoot) || document)`

const vanityOf = (profile: string): string | null => {
  try {
    const match = new URL(profile.startsWith('http') ? profile : `https://www.linkedin.com/in/${profile.replace(/^\/?(in\/)?/, '')}`).pathname.match(/^\/in\/([^/]+)/)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

const profileUrl = (vanity: string): string => `https://www.linkedin.com/in/${encodeURIComponent(vanity)}/`

/** A company page's slug, from its link or the slug itself. */
const slugOf = (page: string): string | null => {
  const match = page.match(/\/company\/([^/?#]+)/) ?? page.match(/^([a-z0-9][a-z0-9-]*)$/i)
  return match?.[1] ?? null
}

type Person = { vanity: string; name: string; degree: string; headline: string; action: string }

export const PEOPLE_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main') || document.body;
  const people = [];
  const seen = new Set();
  for (const li of main.querySelectorAll('li')) {
    const a = li.querySelector('a[href*="/in/"]');
    if (!a) continue;
    const m = new URL(a.href).pathname.match(/^\/in\/([^/]+)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const lines = li.innerText.split('\n').map(clean).filter(Boolean);
    const degree = ((lines.find(l => /\b(1st|2nd|3rd\+?)\b/.test(l)) || '').match(/\b(1st|2nd|3rd\+?)\b/) || [''])[0];
    const headline = lines.find((l, i) => i > 0 && !/degree connection|^·|mutual connection|followers|^(Connect|Follow|Message|Pending)$/.test(l)) || '';
    const button = [...li.querySelectorAll('button, a')].map(b => clean(b.getAttribute('aria-label') || b.innerText)).find(t => /^Invite .* to connect$|^Follow |^Message|^Pending/.test(t)) || '';
    const action = /^Invite/.test(button) ? 'connect' : /^Follow/.test(button) ? 'follow' : /^Pending/.test(button) ? 'pending' : /^Message/.test(button) ? 'message' : '';
    people.push({ vanity: decodeURIComponent(m[1]), name: lines[0] || '', degree, headline, action });
  }
  return {
    people: people.filter(p => p.name && p.name !== 'LinkedIn Member'),
    hasMore: [...main.querySelectorAll('button')].some(b => /Show more results/i.test(b.innerText)),
    total: (main.innerText.match(/([\d,]+) associated members?/) || ['', ''])[1],
    notFound: /Page not found|This page doesn.t exist/i.test(document.body.innerText.slice(0, 2000)),
    signedOut: ${SIGNED_OUT},
  };
})()`

const SHOW_MORE = String.raw`(() => {
  const b = [...(document.querySelector('main') || document.body).querySelectorAll('button')].find(b => /Show more results/i.test(b.innerText));
  if (!b) return { none: true };
  b.scrollIntoView({ block: 'center' });
  const box = b.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`

export const COMPANY_SEARCH = (name: string): string => String.raw`(() => {
  const wanted = ${JSON.stringify(name.toLowerCase())};
  const links = [...(document.querySelector('main') || document.body).querySelectorAll('a[href*="/company/"]')];
  const pick = links.find(a => (a.innerText || '').trim().toLowerCase() === wanted) || links.find(a => (a.innerText || '').toLowerCase().includes(wanted));
  if (!pick) return { none: true, seen: links.slice(0, 5).map(a => (a.innerText || '').trim().slice(0, 40)) };
  const m = new URL(pick.href).pathname.match(/^\/company\/([^/]+)/);
  return { slug: m ? m[1] : null, text: (pick.innerText || '').trim().slice(0, 60) };
})()`

/** The invite dialog: whether it offers Send without a note, and anything else it says. */
export const INVITE_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const shown = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')].filter(shown);
  const d = dialogs[dialogs.length - 1];
  if (!d) return { none: true };
  const text = clean(d.innerText).slice(0, 400);
  const send = [...d.querySelectorAll('button')].find(b => /^Send without a note$/i.test(clean(b.innerText)));
  const asksEmail = !!d.querySelector('input[type="email"], input[name="email"]');
  const point = el => { const box = el.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; };
  const dismiss = [...d.querySelectorAll('button')].find(b => /^Dismiss$|^Cancel$|^Close$/i.test(clean(b.getAttribute('aria-label') || b.innerText)));
  return {
    text,
    send: send && !asksEmail ? point(send) : null,
    dismiss: dismiss ? point(dismiss) : null,
    limit: /invitation limit|reached the (weekly )?limit|too many invitations/i.test(text),
  };
})()`

const LIMIT_REACHED = 'LinkedIn says the invitation limit is reached'

type Invite = { none?: boolean; text?: string; send?: { x: number; y: number } | null; dismiss?: { x: number; y: number } | null; limit?: boolean }

export const PROFILE_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const shown = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const main = document.querySelector('main') || document.body;
  const lines = main.innerText.split('\n').map(clean).filter(Boolean).slice(0, 20);
  const degreeAt = lines.findIndex(l => /^·?\s*(1st|2nd|3rd\+?)$/.test(l));
  const controls = [...main.querySelectorAll('a, button')].filter(shown);
  const words = b => clean(b.getAttribute('aria-label') || b.innerText);
  const message = controls.find(b => b.tagName === 'A' && /\/messaging\/compose\//.test(b.getAttribute('href') || '') && /^(Message|Send a message)/i.test(words(b)));
  let point = null;
  if (message) { message.scrollIntoView({ block: 'center' }); const box = message.getBoundingClientRect(); point = { x: box.left + box.width / 2, y: box.top + box.height / 2 }; }
  return {
    name: document.title.replace(/ \| LinkedIn$/, '').replace(/^\(\d+\)\s*/, ''),
    degree: degreeAt >= 0 ? lines[degreeAt].replace(/^·\s*/, '') : '',
    headline: degreeAt >= 0 ? lines[degreeAt + 1] || '' : '',
    pending: controls.some(b => /^Pending|withdraw invitation/i.test(words(b))),
    message: point,
    notFound: /Page not found|This page doesn.t exist/i.test(document.body.innerText.slice(0, 2000)),
    signedOut: ${SIGNED_OUT},
  };
})()`

type Profile = { name: string; degree: string; headline: string; pending: boolean; message: { x: number; y: number } | null; notFound: boolean; signedOut: boolean }

/** A company page's own id, from its "See all employees" search link: people search filters by it. */
export const COMPANY_ID_SCRIPT = String.raw`(() => {
  const ids = [];
  for (const a of document.querySelectorAll('a[href*="currentCompany"]')) {
    try {
      const raw = new URL(a.href).searchParams.get('currentCompany') || '';
      for (const m of raw.matchAll(/\d+/g)) if (!ids.includes(m[0])) ids.push(m[0]);
    } catch (e) {}
  }
  return {
    id: ids[0] || null,
    notFound: /Page not found|This page doesn.t exist/i.test(document.body.innerText.slice(0, 2000)),
    signedOut: ${SIGNED_OUT},
  };
})()`

type Found = { vanity: string; name: string; headline: string }

/**
 * People search results: one card per person, read from the card's first
 * profile link. Later links in a card are mutual connections, not the person.
 */
export const SEARCH_PEOPLE_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main') || document.body;
  const isCard = e => e.tagName === 'LI' || e.getAttribute('role') === 'listitem';
  const cards = [];
  for (const a of main.querySelectorAll('a[href*="/in/"]')) {
    let card = a.parentElement;
    for (let i = 0; i < 12 && card && card !== main && !isCard(card); i++) card = card.parentElement;
    if (card && card !== main && isCard(card) && !cards.includes(card)) cards.push(card);
  }
  const noise = /^•?\s*(1st|2nd|3rd\+?)$|degree connection|^View .*profile|^(Connect|Follow|Message|Pending)$|mutual connection|^Status is /i;
  const people = [];
  const seen = new Set();
  for (const card of cards) {
    const a = card.querySelector('a[href*="/in/"]');
    let m = null;
    try { m = new URL(a.href).pathname.match(/^\/in\/([^/]+)/); } catch (e) {}
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const lines = card.innerText.split('\n').map(clean).map(l => l.replace(/\s*•\s*(1st|2nd|3rd\+?)$/, '')).filter(Boolean).filter(l => !noise.test(l));
    people.push({ vanity: decodeURIComponent(m[1]), name: lines[0] || '', headline: lines[1] || '' });
  }
  return {
    people: people.filter(p => p.name && !/^LinkedIn Member$/i.test(p.name)),
    none: /No results found/i.test(main.innerText),
    signedOut: ${SIGNED_OUT},
  };
})()`

/** Pages of 1st-degree results read at most: ten people a page. */
const CONNECTION_PAGES = 10

type Connection = { vanity: string; name: string; headline: string; on: string }

export const CONNECTIONS_SCRIPT = String.raw`(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main') || document.body;
  const people = [];
  const seen = new Set();
  for (const a of main.querySelectorAll('a[href*="/in/"]')) {
    const m = new URL(a.href).pathname.match(/^\/in\/([^/]+)/);
    if (!m || seen.has(m[1])) continue;
    let card = a;
    for (let i = 0; i < 8 && card; i++) { if (/Connected on/.test(card.innerText || '')) break; card = card.parentElement; }
    if (!card) continue;
    seen.add(m[1]);
    const lines = card.innerText.split('\n').map(clean).filter(Boolean);
    people.push({
      vanity: decodeURIComponent(m[1]),
      name: lines[0] || '',
      headline: lines[1] && !/^Connected on/.test(lines[1]) ? lines[1] : '',
      on: (lines.find(l => /^Connected on /.test(l)) || '').replace(/^Connected on /, ''),
    });
  }
  return { people, signedOut: ${SIGNED_OUT} };
})()`

/** Tags the message box for this person: the one whose conversation names them. Answers what it holds. */
export const EDITOR_SCRIPT = (name: string): string => String.raw`(() => {
  const root = ${ROOT};
  const shown = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  root.querySelectorAll('[data-jobapp-editor]').forEach(e => e.removeAttribute('data-jobapp-editor'));
  const editors = [...root.querySelectorAll('.msg-form__contenteditable[contenteditable="true"], [contenteditable="true"][aria-label^="Write a message"]')].filter(shown);
  const wanted = ${JSON.stringify(name)};
  for (const editor of editors) {
    let box = editor;
    while (box && !(box.innerText || '').includes(wanted)) box = box.parentElement;
    // The smallest part naming them must hold this one box, not several conversations.
    if (!box || box.querySelectorAll('[contenteditable="true"]').length !== 1) continue;
    editor.setAttribute('data-jobapp-editor', '1');
    return { found: true, text: editor.innerText.replace(/\u00a0/g, ' ') };
  }
  return { found: false, open: editors.length };
})()`

/**
 * The tagged box's compose form (the smallest part holding a file input and
 * Send), as an expression for the page. The conversation and its close
 * button sit above the form.
 */
export const BOX = `(() => { const root = ${ROOT}; const ed = root.querySelector('[data-jobapp-editor="1"]'); let box = ed; while (box && !(box.querySelector && box.querySelector('input[type="file"]') && [...box.querySelectorAll('button')].some(b => (b.innerText || '').trim() === 'Send'))) box = box.parentElement; return { root, ed, box } })()`

/** All the text the message overlay shows: a shadow root has no innerText of its own. */
export const OVERLAY_TEXT = `(() => { const root = ${ROOT}; return root === document ? document.body.innerText : [...root.children].map(c => c.innerText || '').join('\\n'); })()`

export const BOX_SCRIPT = String.raw`(() => {
  const { root, ed, box } = ${BOX};
  if (!ed || !box) return { none: true };
  const point = el => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
  const shown = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = b => (b.getAttribute('aria-label') || b.innerText || '').trim();
  const send = [...box.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'Send');
  // Buttons carry their label as hidden text. Close only when this is the one conversation open.
  const closes = [...root.querySelectorAll('button')].filter(shown).filter(b => /^Close your (draft )?conversation/i.test(label(b)));
  return {
    text: ed.innerText.replace(/\u00a0/g, ' '),
    boxText: (box.innerText || '').replace(/\u00a0/g, ' '),
    send: send && !send.disabled ? point(send) : null,
    close: closes.length === 1 ? point(closes[0]) : null,
  };
})()`

type Box = { none?: boolean; text?: string; boxText?: string; send?: { x: number; y: number } | null; close?: { x: number; y: number } | null }

/** The words of a message, line by line, as the box and the template should agree on them. */
const linesOf = (text: string): string[] =>
  text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

async function clearBox(ctx: RunContext): Promise<void> {
  await ctx.chrome
    .evaluate(`(() => { const { ed } = ${BOX}; if (!ed) return; ed.focus(); document.execCommand('selectAll'); document.execCommand('delete'); })()`, true)
    .catch(() => undefined)
}

/** The company's LinkedIn slug: from its saved page, or LinkedIn's company search by name, which is then saved. */
async function companySlug(ctx: RunContext, company: Company): Promise<string | null> {
  const saved = company.linkedinUrl ? slugOf(company.linkedinUrl) : null
  if (saved) return saved
  await ctx.chrome.openPage(`https://www.linkedin.com/search/results/companies/?${new URLSearchParams({ keywords: company.name }).toString()}`)
  await waitFor(ctx, `document.querySelector('main a[href*="/company/"]')`, 8000)
  const found = await ctx.chrome.evaluate<{ slug?: string | null }>(COMPANY_SEARCH(company.name))
  if (!found.slug) return null
  ctx.store.companies.setLinks(company.id, { linkedinUrl: `https://www.linkedin.com/company/${found.slug}/` })
  return found.slug
}

/** The user's 1st-degree connections who work at the company now, by LinkedIn's people search. */
async function connectionsAt(ctx: RunContext, companyId: string): Promise<{ people: Found[]; signedOut: boolean }> {
  const people: Found[] = []
  for (let page = 1; page <= CONNECTION_PAGES; page++) {
    const query = new URLSearchParams({ currentCompany: JSON.stringify([companyId]), network: JSON.stringify(['F']), origin: 'FACETED_SEARCH', ...(page > 1 ? { page: String(page) } : {}) })
    await ctx.chrome.openPage(`https://www.linkedin.com/search/results/people/?${query.toString()}`)
    await waitFor(ctx, `document.querySelector('main a[href*="/in/"]') || /No results found/i.test(document.body.innerText) || ${SIGNED_OUT}`, 10_000)
    await sleep(800)
    const result = await ctx.chrome.evaluate<{ people: Found[]; none: boolean; signedOut: boolean }>(SEARCH_PEOPLE_SCRIPT)
    if (result.signedOut) return { people, signedOut: true }
    const fresh = result.people.filter(person => !people.some(one => one.vanity === person.vanity))
    if (result.none || fresh.length === 0) break
    people.push(...fresh)
  }
  return { people, signedOut: false }
}

/** What a referral session sends: the message about one job, to the people picked. */
export type MessagePlan = { jobId: number; personIds: number[]; resume: boolean }

/**
 * LinkedIn's network tools for the referral track. A connect session at one
 * company gets find_people and send_blank_request; checking gets
 * list_new_connections; a company's refresh gets company_connections; a
 * referral session gets send_referral_message for one job.
 */
export function linkedinNetworkTools(ctx: RunContext, which: { connect?: Company; check?: boolean; message?: MessagePlan; people?: Company }): AnyTool[] {
  const tools: AnyTool[] = []
  const { store } = ctx

  if (which.people) {
    const company = which.people
    tools.push(
      portalTool(
        ctx,
        'linkedin',
        'company_connections',
        `Read the user's LinkedIn connections who work at ${company.name} now. Each one is recorded as working there and connected, and requests they had pending move to connected. Answers who was added and who accepted.`,
        {},
        async () => {
          const slug = await companySlug(ctx, company)
          if (!slug) return refuse(`No LinkedIn company page matched "${company.name}". The user can add its LinkedIn page on the company, then refresh again. Finish now.`)
          await ctx.chrome.openPage(`https://www.linkedin.com/company/${slug}/`)
          await waitFor(ctx, `document.querySelector('a[href*="currentCompany"]') || /Page not found|This page doesn.t exist/i.test(document.body.innerText) || ${SIGNED_OUT}`, 10_000)
          const page = await ctx.chrome.evaluate<{ id: string | null; notFound: boolean; signedOut: boolean }>(COMPANY_ID_SCRIPT)
          markSite(ctx, 'linkedin', page.signedOut ? 'signed-out' : 'signed-in')
          if (page.signedOut) return refuse('LinkedIn is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then try again.')
          if (page.notFound) return refuse(`LinkedIn has no company page at /company/${slug}/. Finish now.`)
          if (!page.id) return refuse(`The LinkedIn page /company/${slug}/ gives no link to its employees, so its people cannot be searched. Finish now.`)

          const result = await connectionsAt(ctx, page.id)
          if (result.signedOut) return refuse('LinkedIn signed out during the search. Call hand_to_user with what "sign-in", then try again.')

          const added: string[] = []
          const accepted: string[] = []
          const joined: string[] = []
          store.transaction(() => {
            for (const found of result.people) {
              const url = profileUrl(found.vanity)
              const known = store.people.byProfile(url)
              if (!known) {
                store.people.addConnected({ name: found.name, headline: found.headline, profileUrl: url, companyId: company.id }, ctx.runId)
                added.push(found.name)
                continue
              }
              store.people.setHeadline(known.id, found.headline)
              if (store.people.join(known.id, company.id, ctx.runId)) joined.push(known.name)
              if (known.state === 'requested') {
                store.people.setState(known.id, 'connected', { runId: ctx.runId, companyId: company.id })
                accepted.push(known.name)
              }
            }
          })
          if (added.length || accepted.length || joined.length) {
            ctx.count('added', added.length)
            ctx.count('accepted', accepted.length)
            ctx.changed('people')
          }
          ctx.log('good', `${company.name}: ${result.people.length} connections there, ${added.length} new, ${accepted.length} accepted`)
          return say(
            [
              `${result.people.length} of the user's connections work at ${company.name} (/company/${slug}/).`,
              added.length ? `Added as connected: ${added.join('; ')}.` : 'Nobody new to add.',
              accepted.length ? `Accepted a request: ${accepted.join('; ')}.` : 'No pending request was accepted.',
              joined.length ? `Now recorded at ${company.name} too: ${joined.join('; ')}.` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
        },
      ),
    )
  }

  if (which.connect) {
    const company = which.connect
    tools.push(
      portalTool(
        ctx,
        'linkedin',
        'find_people',
        'List people at a company on LinkedIn whose profiles match the keywords, such as a field or a title: name, degree, headline, and whether a connection request can go. People the user already knows are left out. Give the company\'s LinkedIn page (read_job gives it) or, without one, its name.',
        {
          company: z.string().min(1).max(200).describe('The company\'s name'),
          company_page: z.string().max(300).optional().describe('Its LinkedIn page link, linkedin.com/company/<slug>/...'),
          keywords: z.string().max(100).describe('Words their profiles should match, such as "frontend engineer"'),
          more: z.number().int().min(0).max(4).optional().describe('How many times to load more results, 0 by default'),
        },
        async ({ company: name, company_page, keywords, more }) => {
          let slug = company_page ? slugOf(company_page) : company.linkedinUrl ? slugOf(company.linkedinUrl) : null
          if (!slug) {
            await ctx.chrome.openPage(`https://www.linkedin.com/search/results/companies/?${new URLSearchParams({ keywords: name }).toString()}`)
            await waitFor(ctx, `document.querySelector('main a[href*="/company/"]')`, 8000)
            const found = await ctx.chrome.evaluate<{ slug?: string | null; none?: boolean; seen?: string[] }>(COMPANY_SEARCH(name))
            if (!found.slug) return refuse(`No LinkedIn company page matched "${name}". Pass its page as company_page, or finish.`)
            slug = found.slug
          }
          if (!company.linkedinUrl) store.companies.setLinks(company.id, { linkedinUrl: `https://www.linkedin.com/company/${slug}/` })
          await ctx.chrome.openPage(`https://www.linkedin.com/company/${slug}/people/?${new URLSearchParams({ keywords }).toString()}`)
          await waitFor(ctx, `document.querySelector('main li a[href*="/in/"]') || /Page not found|0 associated members|No results/i.test(document.body.innerText)`, 10_000)
          for (let i = 0; i < (more ?? 0); i++) {
            const button = await ctx.chrome.evaluate<{ x?: number; y?: number; none?: boolean }>(SHOW_MORE)
            if (button.none) break
            await clickPoint(ctx, button)
            await sleep(1800)
          }
          const result = await ctx.chrome.evaluate<{ people: Person[]; hasMore: boolean; total: string; notFound: boolean; signedOut: boolean }>(PEOPLE_SCRIPT)
          markSite(ctx, 'linkedin', result.signedOut ? 'signed-out' : 'signed-in')
          if (result.signedOut) return refuse('LinkedIn is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then try again.')
          if (result.notFound) return refuse(`LinkedIn has no company page at /company/${slug}/.`)
          const fresh = result.people.filter(person => !store.people.isKnown(profileUrl(person.vanity)))
          return say(
            [
              `${name} on LinkedIn (/company/${slug}/), people matching "${keywords}": ${result.people.length} shown, ${fresh.length} the user doesn't know yet.`,
              ...fresh.map(person =>
                [`${person.vanity}`, person.name, person.degree || 'degree unknown', person.headline, person.action === 'connect' || person.action === 'follow' ? 'can connect' : person.action === 'pending' ? 'request already pending' : person.degree === '1st' ? 'already connected' : person.action]
                  .filter(Boolean)
                  .join(' | '),
              ),
              result.hasMore ? 'More results: yes (call again with more: 1 or higher).' : 'More results: no.',
            ].join('\n'),
          )
        },
      ),
      portalTool(
        ctx,
        'linkedin',
        'send_blank_request',
        `Send one person at ${company.name} a LinkedIn connection request with no note: never a note, whatever the dialog suggests. Someone already connected is recorded as connected, and a request already pending as sent, without sending anything.`,
        {
          profile: z.string().max(300).describe('Their profile link, or the vanity name find_people gives'),
          name: z.string().min(1).max(120),
          headline: z.string().max(300).describe('Their headline, for the record'),
        },
        async ({ profile, name, headline }) => {
          // LinkedIn's limit holds for the whole account: once one session meets it, none sends again.
          const halted = ctx.halted()
          if (halted) return refuse(`${halted}. Stop sending requests and finish.`)
          const vanity = vanityOf(profile)
          if (!vanity) return refuse('That is not a LinkedIn profile.')
          const url = profileUrl(vanity)
          const person = { name, headline, profileUrl: url, companyId: company.id }
          const known = store.people.byProfile(url)
          if (known) {
            const joined = store.people.join(known.id, company.id, ctx.runId)
            if (joined) ctx.changed('people')
            return say(`${name} is already someone the user knows${joined ? `, now recorded at ${company.name} too` : ''}.`)
          }

          await ctx.chrome.openPage(`https://www.linkedin.com/preload/custom-invite/?${new URLSearchParams({ vanityName: vanity }).toString()}`)
          await waitFor(ctx, `[...document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')].some(d => d.getBoundingClientRect().width > 0)`, 6000)
          const invite = await ctx.chrome.evaluate<Invite>(INVITE_SCRIPT)

          if (invite.limit) {
            ctx.halt(LIMIT_REACHED)
            return refuse(`${LIMIT_REACHED}. Stop sending requests and finish.`)
          }
          if (!invite.none && invite.send) {
            await clickPoint(ctx, invite.send)
            await sleep(1500)
            const after = await ctx.chrome.evaluate<Invite>(INVITE_SCRIPT)
            const said = await ctx.chrome.evaluate<string>('document.body.innerText.slice(0, 4000)', true).catch(() => '')
            if (after.limit || /invitation limit|reached the (weekly )?limit/i.test(said)) {
              ctx.halt(LIMIT_REACHED)
              return refuse(`${LIMIT_REACHED}. Stop sending requests and finish.`)
            }
            if (!after.none) {
              // Still open, or a different question (such as their email): either way, not sent.
              if (!after.send && after.dismiss) await clickPoint(ctx, after.dismiss)
              return refuse(`The request to ${name} did not go. LinkedIn says: "${(after.text ?? '').slice(0, 160)}". Skipped.`)
            }
            store.people.addRequested(person, ctx.runId)
            ctx.count('sent')
            ctx.changed('people')
            ctx.log('good', `Request sent to ${name} at ${company.name}`)
            return say(`Sent: a blank request to ${name}.`)
          }
          if (!invite.none) {
            if (invite.dismiss) await clickPoint(ctx, invite.dismiss)
            return refuse(`LinkedIn did not offer a plain request for ${name}${invite.text ? `: "${invite.text.slice(0, 160)}"` : ''}. Skipped.`)
          }

          // No dialog: see why on the profile itself.
          await ctx.chrome.openPage(url)
          const page = await ctx.chrome.evaluate<Profile>(PROFILE_SCRIPT)
          if (page.signedOut) return refuse('LinkedIn is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then try again.')
          if (page.degree === '1st') {
            store.people.addConnected(person, ctx.runId)
            ctx.count('accepted')
            ctx.changed('people')
            return say(`${name} is already a connection: recorded as connected, ready for the referral message.`)
          }
          if (page.pending) {
            store.people.addRequested(person, ctx.runId)
            ctx.changed('people')
            return say(`A request to ${name} was already pending: recorded as sent.`)
          }
          return refuse(`LinkedIn offered no connection request for ${name}. Skipped.`)
        },
        {
          steps: ({ name, profile }) => [`In Chrome, open ${name}'s profile (${profile})`, 'Press Connect, then Send without a note', 'Come back here and press Continue'],
          afterUser: async ({ profile, name, headline }) => {
            const vanity = vanityOf(profile)
            if (vanity) store.people.addRequested({ name, headline, profileUrl: profileUrl(vanity), companyId: company.id }, ctx.runId)
            ctx.changed('people')
            return say(`The user sent the request to ${name}.`)
          },
        },
      ),
    )
  }

  if (which.check) {
    tools.push(
      portalTool(
        ctx,
        'linkedin',
        'list_new_connections',
        'Read the user\'s newest LinkedIn connections, back to the oldest request still out, and move everyone who accepted to connected. Answers who accepted.',
        {},
        async () => {
          const waiting = store.people.requested()
          if (waiting.length === 0) return say('Nobody has a request out: there is nothing to check.')
          const dates = waiting.map(person => Date.parse(person.requested ?? '')).filter(at => !Number.isNaN(at))
          const cutoff = (dates.length ? Math.min(...dates) : Date.now()) - 2 * 86_400_000

          await ctx.chrome.openPage('https://www.linkedin.com/mynetwork/invite-connect/connections/')
          await waitFor(ctx, `/Connected on/.test((document.querySelector('main') || document.body).innerText) || ${SIGNED_OUT}`, 10_000)
          let result = await ctx.chrome.evaluate<{ people: Connection[]; signedOut: boolean }>(CONNECTIONS_SCRIPT)
          markSite(ctx, 'linkedin', result.signedOut ? 'signed-out' : 'signed-in')
          if (result.signedOut) return refuse('LinkedIn is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then check again.')
          for (let i = 0; i < 15; i++) {
            const last = result.people[result.people.length - 1]
            const lastAt = last ? Date.parse(last.on) : Number.NaN
            if (!last || (!Number.isNaN(lastAt) && lastAt < cutoff)) break
            await ctx.chrome.evaluate(SCROLL_TO_END, true)
            await sleep(2000)
            const more = await ctx.chrome.evaluate<{ x?: number; y?: number; none?: boolean }>(SHOW_MORE)
            if (!more.none) {
              await clickPoint(ctx, more)
              await sleep(1500)
            }
            const next = await ctx.chrome.evaluate<{ people: Connection[]; signedOut: boolean }>(CONNECTIONS_SCRIPT)
            if (next.people.length === result.people.length) break
            result = next
          }

          const accepted: string[] = []
          store.transaction(() => {
            for (const found of result.people) {
              const person = store.people.byProfile(profileUrl(found.vanity))
              if (!person || person.state !== 'requested') continue
              store.people.setState(person.id, 'connected', { runId: ctx.runId })
              accepted.push(person.name)
            }
            store.people.markChecked(new Date().toISOString())
          })
          if (accepted.length) {
            ctx.count('accepted', accepted.length)
            ctx.changed('people')
            ctx.log('good', `${accepted.length} accepted`)
          }
          return say(
            [`Read ${result.people.length} newest connections against ${waiting.length} requests out.`, accepted.length ? `Accepted: ${accepted.join('; ')}.` : 'Nobody new accepted.'].join('\n'),
          )
        },
      ),
    )
  }

  if (which.message) {
    const plan = which.message
    /** The message for one person, filled from the user's approved wording. */
    const messageFor = (personId: number): { message: string; job: NonNullable<ReturnType<typeof store.jobs.get>>; name: string } | string => {
      const job = store.jobs.get(plan.jobId)
      if (!job) return 'That job is no longer in the tracker. Finish now.'
      const person = store.people.get(personId)
      if (!person) return `There is no person ${personId}.`
      const referral = store.settings.referral()
      if (!referral.template.trim()) return 'The user has not saved a referral message in Settings. Finish now.'
      try {
        const message = fillTemplate(referral.template, { name: firstName(person.name), role: job.role, company: job.company, jobId: job.reqId ?? '', jobLink: job.link || job.portalLink || '' })
        return { message, job, name: person.name }
      } catch (error) {
        return `${error instanceof Error ? error.message : String(error)} Skipped.`
      }
    }

    tools.push(
      portalTool(
        ctx,
        'linkedin',
        'send_referral_message',
        'Send the user\'s approved referral message to one person, by their id from the list. The app fills the slots, types the message word for word, attaches the resume when the user asked for it, and sends. You write nothing.',
        { person_id: z.number().int().positive() },
        async ({ person_id }) => {
          if (!plan.personIds.includes(person_id)) return refuse(`Person ${person_id} is not on this run's list.`)
          const person = store.people.get(person_id)
          if (!person) return refuse(`There is no person ${person_id}.`)
          if (person.state !== 'connected') return refuse(`${person.name} has not accepted the request yet: only connections get the message.`)
          const filled = messageFor(person_id)
          if (typeof filled === 'string') return refuse(filled)
          const { message, job } = filled
          if (!store.people.currentCompanies(person.id).includes(job.companyId)) return refuse(`${person.name} no longer works at ${job.company}. Skipped.`)
          if (store.outreach.find(job.id, person.id)) return refuse(`${person.name} was already asked about ${job.role}. Skipped.`)
          const resume = plan.resume ? namedResume(ctx) : null
          if (plan.resume && !resume) return refuse('The message attaches the resume, and there is none in Settings. Finish now.')

          const vanity = vanityOf(person.profileUrl)
          if (!vanity) return refuse(`${person.name}'s profile link is not a LinkedIn profile.`)
          await ctx.chrome.openPage(profileUrl(vanity))
          const page = await ctx.chrome.evaluate<Profile>(PROFILE_SCRIPT)
          if (page.signedOut) return refuse('LinkedIn is signed out in the app\'s Chrome. Call hand_to_user with what "sign-in", then try again.')
          if (page.degree !== '1st') return refuse(`${person.name} is not a 1st-degree connection on LinkedIn (${page.degree || 'unknown'}). Skipped.`)
          if (!page.message) return refuse(`${person.name}'s profile has no Message button. Skipped.`)
          const shownName = page.name || person.name

          await clickPoint(ctx, page.message)
          if (!(await waitFor(ctx, `${ROOT}.querySelector('.msg-form__contenteditable, [contenteditable="true"][aria-label^="Write a message"]')`, 10_000))) {
            return refuse('The message box did not open. Skipped.')
          }
          await sleep(800)
          const editor = await ctx.chrome.evaluate<{ found: boolean; text?: string }>(EDITOR_SCRIPT(shownName.split(' ')[0] ?? shownName))
          if (!editor.found) return refuse(`No message box to ${person.name} opened. Skipped.`)
          if (linesOf(editor.text ?? '').length) return refuse(`There is an unsent draft to ${person.name} in LinkedIn. It is the user's: left as it is, and skipped.`)

          // Type it as written: each line, with Shift+Enter between lines so nothing sends early.
          await ctx.chrome.evaluate(`(() => { const { ed } = ${BOX}; if (ed) ed.focus(); })()`, true)
          const lines = message.replace(/\r/g, '').split('\n')
          for (const [i, line] of lines.entries()) {
            if (line) await ctx.chrome.insertText(line)
            if (i < lines.length - 1) await ctx.chrome.pressKey('Enter', true)
          }
          await sleep(500)
          let box = await ctx.chrome.evaluate<Box>(BOX_SCRIPT)
          if (box.none || JSON.stringify(linesOf(box.text ?? '')) !== JSON.stringify(linesOf(message))) {
            await clearBox(ctx)
            return refuse('The message box did not hold the approved wording exactly, so nothing was sent. Skipped.')
          }

          if (resume) {
            const name = basename(resume)
            await ctx.chrome.setFilesAt(`(() => { const { box } = ${BOX}; return box && (box.querySelector('input[type="file"][accept*=".pdf"]') || box.querySelector('input[type="file"]')); })()`, [resume])
            // The preview may cut a long name short: its start, or the .pdf, shows it attached.
            const shownAs = [name, name.slice(0, 15), '.pdf'].map(text => JSON.stringify(text)).join(', ')
            if (!(await waitFor(ctx, `(() => { const text = ((${BOX}).box?.innerText || ''); return [${shownAs}].some(part => text.includes(part)); })()`, 20_000))) {
              await clearBox(ctx)
              return refuse('The resume did not attach, so nothing was sent. Skipped.')
            }
            await sleep(1500)
            box = await ctx.chrome.evaluate<Box>(BOX_SCRIPT)
          }
          if (!box.send) {
            await clearBox(ctx)
            return refuse('Send was not ready, so nothing was sent. Skipped.')
          }
          await ctx.chrome.allowSubmit()
          await clickPoint(ctx, box.send)
          // Sent once the box is empty and the conversation shows the message: its longest plain line, which no other text shares.
          const marker = [...linesOf(message)].filter(line => !/https?:\/\//.test(line)).sort((a, b) => b.length - a.length)[0]?.slice(0, 60) || (linesOf(message)[0] ?? '').slice(0, 60)
          const went = await waitFor(
            ctx,
            `(() => { const { ed } = ${BOX}; const text = ${OVERLAY_TEXT}; return (!ed || !ed.innerText.trim()) && text.includes(${JSON.stringify(marker)}) && !/failed to send|message not sent|couldn.t send/i.test(text); })()`,
            15_000,
          )
          if (!went) return refuse(`LinkedIn did not show the message to ${person.name} as sent. Check Chrome before trying again: it may have gone.`)

          store.recordOutreach({ jobId: job.id, personId: person.id, message, resume: !!resume }, ctx.runId)
          store.jobs.appendNote(job.id, `Referral message sent to ${person.name} (${person.headline}).`)
          ctx.count('messaged')
          ctx.changed('people', 'jobs')
          ctx.log('good', `Message sent to ${person.name} about ${job.role}`)
          const after = await ctx.chrome.evaluate<Box>(BOX_SCRIPT).catch(() => ({ close: null }) as Box)
          if (after.close) await clickPoint(ctx, after.close).catch(() => undefined)
          return say(`Sent to ${person.name}.`)
        },
        {
          steps: ({ person_id }) => {
            const filled = messageFor(person_id)
            const person = store.people.get(person_id)
            return [
              `In Chrome, open ${person?.name ?? 'their'}'s profile and press Message`,
              typeof filled === 'string' ? 'Send your saved referral message' : `Send this, word for word${plan.resume ? ', with your resume attached' : ''}: ${filled.message}`,
              'Come back here and press Continue',
            ]
          },
          afterUser: async ({ person_id }) => {
            const filled = messageFor(person_id)
            if (typeof filled !== 'string' && !store.outreach.find(filled.job.id, person_id)) {
              store.recordOutreach({ jobId: filled.job.id, personId: person_id, message: filled.message, resume: plan.resume }, ctx.runId)
            }
            ctx.changed('people', 'jobs')
            return say('The user sent the message themselves.')
          },
        },
      ),
    )
  }

  return tools
}
