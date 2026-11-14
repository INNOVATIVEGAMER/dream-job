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
  'The fewest years of experience the job asks for, as a number: 3 for "3-5 years" or "3+ years", 0 for freshers. Where the apply page and the portal differ, the apply page\'s. null when the posting states no years'
export const YEARS_QUOTE = 'Just the page\'s exact words that state the years asked for, such as "3-5 years of experience", copied from what read_job or read_apply_page returned; "" when min_years is null'

const FRESHER = /fresher|entry[- ]level|new grad|graduate|no (prior )?experience|0\s*-/i

/**
 * The fewest years a job asks for, held to its quote: the quote must be on a
 * page read, speak of years (or freshers), and contain the number given.
 * Answers the value to save, or why it was refused.
 */
export function checkYears(minYears: number | null, quote: string, texts: string[]): { value: number | null; quote: string | null } | string {
  if (minYears === null) return { value: null, quote: null }
  const said = quote.trim()
  if (!said) return 'min_years needs years_quote: the posting\'s exact words that state it. No quote: give null.'
  if (!isQuoted(said, texts)) return `"${said}" is not on any page read for this job. Copy the words exactly from what read_job or read_apply_page returned, or give null.`
  if (!/years?|yrs?/i.test(said) && !FRESHER.test(said)) return 'years_quote must be the words that state the years asked for.'
  // The fewest years the quote states: "3-5 years" asks for 3. Numbers over 40 are years of the calendar or versions, not experience.
  const numbers = (said.match(/\d+/g) ?? []).map(Number).filter(n => n <= 40)
  if (numbers.length === 0) return minYears === 0 && FRESHER.test(said) ? { value: 0, quote: said } : `"${said}" states no number of years. Give null, or quote the words that do.`
  const fewest = Math.min(...numbers)
  if (minYears !== fewest) return `"${said}" asks for at least ${fewest}, not ${minYears}. Give ${fewest}, or quote just the words about the years asked for.`
  return { value: minYears, quote: said }
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
