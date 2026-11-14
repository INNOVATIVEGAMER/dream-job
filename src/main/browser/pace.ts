/*
 * How fast the app opens pages on the portals, across every tab at once.
 *
 * LinkedIn answers an error status instead of a page once pages open too fast
 * (Chrome reports net::ERR_HTTP_RESPONSE_CODE_FAILURE). Measured: a hunt in
 * one tab opened 33 postings, one every 7 s or so, with no refusals; five tabs
 * opening one about every half second were refused after 28 pages, and kept
 * being refused while they retried. So each portal keeps one queue shared by
 * every tab, with a gap between page opens, and backs off when it refuses.
 */

type Site = {
  name: string
  host: RegExp
  /** The gap between page opens: a random wait in this range, so they don't land like a metronome. */
  gapMs: [number, number]
}

const SITES: Site[] = [
  { name: 'LinkedIn', host: /(^|\.)linkedin\.com$/, gapMs: [6_000, 10_000] },
  { name: 'Wellfound', host: /(^|\.)(wellfound\.com|angel\.co)$/, gapMs: [3_000, 5_000] },
  { name: 'Instahyre', host: /(^|\.)instahyre\.com$/, gapMs: [3_000, 5_000] },
  { name: 'JSGuruJobs', host: /(^|\.)jsgurujobs\.com$/, gapMs: [3_000, 5_000] },
  { name: 'OnlyFrontendJobs', host: /(^|\.)onlyfrontendjobs\.com$/, gapMs: [3_000, 5_000] },
  { name: 'Work at a Startup', host: /(^|\.)workatastartup\.com$/, gapMs: [3_000, 5_000] },
  { name: 'Weekday', host: /(^|\.)weekday\.works$/, gapMs: [3_000, 5_000] },
]

/** The first wait after a refusal, doubled for each refusal after it, up to the cap. */
const BACKOFF_MS = 60_000
const BACKOFF_CAP_MS = 10 * 60_000

/** `limitedUntil`: after a second refusal in a row, opens fail at once until then, so no tab keeps asking. */
type State = { queue: Promise<void>; nextAt: number; refusals: number; limitedUntil: number }

const states = new Map<string, State>()

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const between = ([low, high]: [number, number]): number => low + Math.random() * (high - low)

function siteOf(url: string): Site | null {
  try {
    const host = new URL(url).hostname
    return SITES.find(site => site.host.test(host)) ?? null
  } catch {
    return null
  }
}

function stateOf(site: Site): State {
  let state = states.get(site.name)
  if (!state) {
    state = { queue: Promise.resolve(), nextAt: 0, refusals: 0, limitedUntil: 0 }
    states.set(site.name, state)
  }
  return state
}

/** Thrown when a portal keeps refusing pages: the run should leave that portal alone for now. */
export class SiteLimited extends Error {
  constructor(readonly site: string) {
    super(
      `${site} is limiting how fast pages open, and refused this one again after a wait. Leave ${site} for the rest of this run: don't retry, and don't record anything as unreadable because of it. It lifts by itself, usually within the hour.`,
    )
  }
}

/** The error a refused page gives: the site answered an error status instead of a page. */
export const isRefusal = (errorText: string): boolean => /ERR_HTTP_RESPONSE_CODE_FAILURE/.test(errorText)

/**
 * Opens `url` in its turn: waits for the site's queue and gap, then calls
 * `open`, which answers Chrome's error text or null. A refusal from a paced
 * site holds every tab's opens on that site for a minute, then tries once
 * more; a second refusal throws SiteLimited, and so does every open on that
 * site until the back-off ends. Sites without a pace open at once.
 */
export async function paced(url: string, open: () => Promise<string | null>): Promise<string | null> {
  const site = siteOf(url)
  if (!site) return open()
  const state = stateOf(site)

  const turn = async (): Promise<string | null> => {
    if (Date.now() < state.limitedUntil) throw new SiteLimited(site.name)
    const wait = state.nextAt - Date.now()
    if (wait > 0) await sleep(wait)
    const error = await open()
    if (error && isRefusal(error)) {
      state.refusals++
      state.nextAt = Date.now() + Math.min(BACKOFF_MS * 2 ** (state.refusals - 1), BACKOFF_CAP_MS)
      return error
    }
    state.refusals = 0
    state.nextAt = Date.now() + between(site.gapMs)
    return error
  }

  // One open at a time per site, in the order asked, across every tab.
  const run = async (): Promise<string | null> => {
    const first = await turn()
    if (!first || !isRefusal(first)) return first
    const second = await turn()
    if (second && isRefusal(second)) {
      state.limitedUntil = state.nextAt
      throw new SiteLimited(site.name)
    }
    return second
  }
  const result = state.queue.then(run, run)
  state.queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}
