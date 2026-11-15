/*
 * What a session really saw, and the checks that hold Claude's answers to it.
 *
 * Links come from the pages, by code: the posting's link from the portal and
 * job id, the apply link from the apply button read_job found, then the URL
 * the company's page landed on. Facts Claude reads off a page come with the
 * page's own words, and are saved only when those words are on a page this
 * session read. A fact without proof is saved as not stated, never guessed.
 */

import { cleanLink, isPortalLink, linkKey } from '../../shared/links'
import { FRESHER, yearsStated } from '../../shared/years'
import type { Portal } from '../../shared/types'
import type { OnRead, PostingRead } from '../portals/common'
import { applyPages } from './apply-page'
import type { ApplyPages } from './apply-page'

export type Evidence = {
  /** Each posting read_job opened, by `<portal>:<job id>` and by `link:<link key>`. */
  posts: Map<string, PostingRead>
  pages: ApplyPages
}

export const newEvidence = (): Evidence => ({ posts: new Map(), pages: applyPages() })

/** The hook every read_job in the session reports to. */
export function noteReads(evidence: Evidence): OnRead {
  return read => {
    evidence.posts.set(`${read.portal}:${read.jobId}`, read)
    evidence.posts.set(`link:${linkKey(read.postingLink)}`, read)
  }
}

/** The posting read for a job, by its portal and id, or by any of its links. */
export function postingFor(evidence: Evidence, portal: Portal | null, jobId: string | null, links: (string | null | undefined)[] = []): PostingRead | null {
  if (portal && jobId) {
    const byId = evidence.posts.get(`${portal}:${jobId}`)
    if (byId) return byId
  }
  for (const link of links) {
    const byLink = link ? evidence.posts.get(`link:${linkKey(link)}`) : undefined
    if (byLink) return byLink
  }
  return null
}

/** Everything this session read about a job: its portal posting, and its apply page. */
export function textsFor(evidence: Evidence, read: PostingRead | null, applyLinks: (string | null | undefined)[]): string[] {
  const texts = read ? [read.text] : []
  for (const link of applyLinks) {
    const text = link ? evidence.pages.texts.get(linkKey(link)) : undefined
    if (text) texts.push(text)
  }
  return texts
}

/** Text reduced for comparing a quote with a page: case, quote marks, dashes and spacing don't count. */
const flat = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\\(["'])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/** Whether `quote` is word for word on one of the pages read. */
export function isQuoted(quote: string, texts: string[]): boolean {
  const wanted = flat(quote)
  return wanted.length >= 3 && texts.some(text => flat(text).includes(wanted))
}

/** How min_years and years_quote are described to Claude, the same in every flow. */
export const MIN_YEARS =
  'The fewest years of overall experience the job asks for, as a number: 3 for "3-5 years" or "3+ years", 4 for "a minimum of four years", 0 for freshers. ' +
  'Only the words the company wrote count: the posting\'s description, or its apply page; where the two differ, the apply page\'s. ' +
  'Never a portal\'s own experience field (the "Experience field" or "Experience asked" line read_job shows): the app reads that itself, and uses it only when the description states no years. ' +
  'Years with one technology or area ("2+ years with React") are not overall experience. null when the description states no overall years'
export const YEARS_QUOTE =
  'Just the description\'s exact words that state the overall years asked for, such as "3-5 years of experience", copied from what read_job or read_apply_page returned; "" when min_years is null'

/**
 * The fewest years a job asks for, held to its quote: the quote must be on a
 * page read, state years, and its fewest must be the number given.
 * Answers the value to save, or why it was refused.
 */
export function checkYears(minYears: number | null, quote: string, texts: string[]): { value: number | null; quote: string | null } | string {
  if (minYears === null) return { value: null, quote: null }
  const said = quote.trim()
  if (!said) return 'min_years needs years_quote: the description\'s exact words that state it. No quote: give null.'
  if (!isQuoted(said, texts)) return `"${said}" is not in the description or apply page read for this job. Copy the words exactly from what read_job or read_apply_page returned, or give null.`
  const stated = yearsStated(said)
  if (stated.length === 0) {
    if (minYears === 0 && FRESHER.test(said)) return { value: 0, quote: said }
    return `"${said}" states no years of experience ("3+ years", "four years"). Give null, or quote the words that do.`
  }
  // "1.5 years" may be given as 1 or 2.
  const fewest = Math.min(...stated)
  if (minYears !== Math.floor(fewest) && minYears !== Math.ceil(fewest)) {
    return `"${said}" asks for at least ${fewest}, not ${minYears}. Give ${Math.floor(fewest)}, or quote just the words about the overall years asked for.`
  }
  return { value: minYears, quote: said }
}

/** The pages a job's years are held to: the description the company wrote, and its apply page. */
export function describedTexts(evidence: Evidence, read: PostingRead | null, applyLinks: (string | null | undefined)[]): string[] {
  const texts = read ? [read.about ?? read.text] : []
  for (const link of applyLinks) {
    const text = link ? evidence.pages.texts.get(linkKey(link)) : undefined
    if (text) texts.push(text)
  }
  return texts
}

/**
 * The years a job keeps: the description's, held to its quote; when the
 * description states none, the portal's own experience field. Answers the
 * value and the words it rests on, or why Claude's answer was refused.
 */
export function jobYears(
  minYears: number | null,
  quote: string,
  evidence: Evidence,
  read: PostingRead | null,
  applyLinks: (string | null | undefined)[],
): { value: number | null; quote: string | null } | string {
  const described = describedTexts(evidence, read, applyLinks)
  const said = quote.trim()
  if (minYears !== null && said && read?.about !== undefined && !isQuoted(said, described) && isQuoted(said, [read.text])) {
    return `"${said}" is the portal's own field, not the description. Give the years the description states, in its words, or null when it states none: the app then uses the field itself.`
  }
  const checked = checkYears(minYears, quote, described)
  if (typeof checked === 'string' || checked.value !== null || !read?.yearsField) return checked
  return { value: read.yearsField.min, quote: `${read.yearsField.name}: ${read.yearsField.text}` }
}

export const REQ_ID =
  'The company\'s own id for this job exactly as the posting shows it, such as "R0123456" or "JR-2024-1189" (often labelled Job ID, Req ID or Requisition). Not the portal\'s id. "" when the posting shows none'

/** The company's own id for the job, kept only when it is on a page read for this job, as written. */
export function checkReqId(reqId: string, texts: string[]): string | null | { error: string } {
  const said = reqId.trim()
  if (!said) return null
  if (!/\d/.test(said) || said.length > 40) return { error: `"${said}" doesn't look like a job id. Give "" when the posting shows none.` }
  if (!isQuoted(said, texts)) return { error: `"${said}" is not on any page read for this job. Copy it exactly, or give "".` }
  return said
}

export type ApplyOutcome = {
  /** Where the application goes: the company's page as it landed, or the posting itself when it applies on the portal. */
  link: string | null
  route: PostingRead['route'] | null
  state: 'open' | 'unreadable'
  note: string | null
}

/**
 * Where a job's application goes, from what was read: never from Claude. A
 * job that applies off the portal needs its apply page tried with
 * read_apply_page; the page counts as read only when it opened and, as Claude
 * judges, shows the job. Answers the outcome, or why it was refused.
 */
export function applyOutcome(evidence: Evidence, read: PostingRead | null, savedApplyLink: string | null, showsJob: boolean): ApplyOutcome | string {
  const route = read?.route ?? (savedApplyLink ? 'company-site' : null)
  if (route !== 'company-site') return { link: read?.postingLink ?? null, route, state: 'open', note: null }

  const target = (read?.applyUrl && !isPortalLink(read.applyUrl) ? read.applyUrl : null) ?? savedApplyLink
  if (!target) return { link: null, route, state: 'unreadable', note: 'The portal shows no link to the apply page' }
  const key = linkKey(target)
  if (!evidence.pages.tried.has(key)) return `This job applies on the company's site: read_apply_page ${target} first.`
  const opened = evidence.pages.read.has(key)
  return {
    link: evidence.pages.landed.get(key) ?? cleanLink(target),
    route,
    state: opened && showsJob ? 'open' : 'unreadable',
    note: opened && showsJob ? null : 'Apply page not readable',
  }
}
