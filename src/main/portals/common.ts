import type { z } from 'zod'

import { GMAIL_TOOLS, PORTAL_TOOLS, TOOL_SITE_NAMES } from '../../shared/types'
import type { Portal, PortalToolInfo, SignInSite, SiteState, Stage, ToolSite } from '../../shared/types'
import { guarded, refuse, say } from '../browser/tools'
import { defineTool } from '../runs/engine'
import type { AnyTool, RunContext } from '../runs/engine'

type ToolResult = ReturnType<typeof say>
type Shape = Record<string, z.ZodType>
/** A tool's input as the Agent SDK infers it from the shape. */
type Input<S extends Shape> = { [K in keyof S]: S[K] extends { _output: infer O } ? O : never }

/**
 * What a portal's read_job saw, taken from the page by code, never typed by
 * Claude: the hunt and the posting check build each job's links from it, and
 * check Claude's quotes against its text.
 */
export type PostingRead = {
  portal: Portal
  jobId: string
  /** The posting on the portal. */
  postingLink: string
  route: 'easy-apply' | 'company-site' | 'wellfound' | 'instahyre' | 'workatastartup' | 'weekday' | 'unknown'
  /** Where the apply button leads off the portal; null when it applies on the portal, or no link was found. */
  applyUrl: string | null
  closed: boolean
  /** The text read_job answered. */
  text: string
}

export type OnRead = (read: PostingRead) => void

/** The name Claude calls a portal's tool by: portals share tool names, so each carries its portal's. */
export const toolName = (site: ToolSite, name: string): string => `${site}_${name}`

const toolsOf = (site: ToolSite): PortalToolInfo[] => (site === 'gmail' ? GMAIL_TOOLS : PORTAL_TOOLS[site])

/**
 * One of a portal's own tools, held to the user's switches in Settings,
 * Portals, which are read on every call so a change takes effect mid-run:
 * - the portal turned off: refused, so Claude moves on
 * - a find tool turned off: refused with the reason, since there is no
 *   step to hand over
 * - an apply or connect tool turned off: the tool-off card hands that step to
 *   the user in Chrome, and `afterUser` says what happens once they are done
 * Claude calls it `<portal>_<name>`; Settings knows it by `name`.
 */
export function portalTool<S extends Shape>(
  ctx: RunContext,
  portal: ToolSite,
  name: string,
  description: string,
  shape: S,
  handler: (input: Input<S>) => Promise<ToolResult>,
  handover?: { steps: (input: Input<S>) => string[]; afterUser: (input: Input<S>) => Promise<ToolResult> },
): AnyTool {
  const info = toolsOf(portal).find(tool => tool.name === name)
  if (!info) throw new Error(`${name} is not in the ${portal} tool list`)
  return defineTool(toolName(portal, name), description, shape, (input: Input<S>) =>
    guarded(async () => {
      const setting = ctx.portal(portal)
      if (!setting.enabled) return refuse(`${TOOL_SITE_NAMES[portal]} is turned off in Settings. Leave it and go on.`)
      if (setting.tools[name] !== false) return handler(input)
      if (!handover) {
        return refuse(`"${info.label}" is turned off for ${TOOL_SITE_NAMES[portal]} in Settings, so it cannot be used in this run. Go on without it.`)
      }
      ctx.log('warn', `${info.label} is off in Settings: handed to you`)
      await ctx.chrome.bringToFront()
      const reply = await ctx.ask({ kind: 'tool-off', portal, tool: info.label, steps: handover.steps(input) })
      if (reply.kind !== 'resume') return refuse('The user stopped the run. Finish now without doing anything more.')
      ctx.log('step', `You did it: ${info.label}`)
      return handover.afterUser(input)
    }),
  )
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Evaluates `expression` in the tab until it is truthy, up to `ms`; answers whether it became so. */
export async function waitFor(ctx: RunContext, expression: string, ms = 8000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const ok = await ctx.chrome.evaluate<boolean>(`!!(${expression})`, true).catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}

/**
 * Scrolls to the end of whatever holds the page's list: some pages scroll
 * inside <main> (LinkedIn's connections), others scroll the window.
 */
export const SCROLL_TO_END = `(() => {
  const main = document.querySelector('main');
  const el = main && main.scrollHeight > main.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(main).overflowY) ? main : document.scrollingElement || document.documentElement;
  el.scrollTop = el.scrollHeight;
})()`

/** Clicks a point a page script answered, or explains why it cannot. */
export async function clickPoint(ctx: RunContext, point: { x?: number; y?: number }): Promise<void> {
  if (point.x === undefined || point.y === undefined) throw new Error('That control has no position on screen.')
  await ctx.chrome.clickAt(point.x, point.y)
}

/** Records what a portal's own page showed about the sign-in, for Settings, Accounts and Home. */
export function markSite(ctx: RunContext, portal: SignInSite, state: SiteState['state']): void {
  const known = ctx.store.settings.sites().find(site => site.site === portal)
  if (known?.state === state) return
  ctx.store.settings.setSite(portal, state)
  ctx.changed('sites')
}

/**
 * The stage bucket from a headcount band, as portals write it ("51-200
 * employees", "10,001+ employees", "More than 1000 employees"): startup up to
 * 200 people, scaleup up to 1,000, large above. Headcount is the tiebreaker.
 */
export function stageFromSize(size: string): Stage | null {
  const text = size.replace(/,/g, '')
  const more = text.match(/more than\s*(\d+)/i)
  const range = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/)
  const plus = text.match(/(\d+)\s*\+/)
  const high = more ? Number(more[1]) + 1 : range ? Number(range[2]) : plus ? Number(plus[1]) + 1 : null
  if (high === null) return null
  if (high <= 200) return 'startup'
  if (high <= 1000) return 'scaleup'
  return 'large'
}

/** Whether the user has seen this posting already: tracked, discarded or on never show again. */
export function isKnown(ctx: RunContext, portal: Portal, jobId: string, company: string, title: string): boolean {
  const { store } = ctx
  return store.discarded.has(portal, jobId) || !!store.opportunities.findExisting(portal, jobId, company, title) || !!store.neverShow.match(company)
}

/** One line on the stage bucket, for a read_job answer. */
export function stageLine(size: string): string {
  const stage = stageFromSize(size)
  return `Stage bucket: ${stage ? `${stage}, from ${size}` : 'unknown: no headcount shown'}`
}

export { refuse, say }
