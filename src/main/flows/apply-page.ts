import { z } from 'zod'

import { cleanLink, linkKey } from '../../shared/links'
import { guarded, portalOf, readPage, refuse, say } from '../browser/tools'
import { defineTool } from '../runs/engine'
import type { AnyTool, RunContext } from '../runs/engine'

/**
 * The apply pages a session asked for and the ones it read, by link key. The
 * flows' record tools check these, so an apply page counts as read, or as
 * unreadable, only when this session really opened it.
 */
export type ApplyPages = {
  /** Every link read_apply_page was asked to open, whether or not it opened. */
  tried: Set<string>
  /** Every page it read: as asked for, and where it landed. */
  read: Set<string>
}

export const applyPages = (): ApplyPages => ({ tried: new Set(), read: new Set() })

/**
 * Opens a posting's own apply page off the portal and reads it whole. That
 * page, not the portal's copy, is the final word on the job: portals keep
 * postings up after they close, and their facts drift.
 */
export function applyPageTool(ctx: RunContext, pages: ApplyPages): AnyTool {
  return defineTool(
    'read_apply_page',
    "Open a posting's own apply page, off the portal (the company's site or its applicant tracking system, the link read_job gives), and read it whole: the URL it landed on after redirects, and its text. Read only: nothing on it is clicked, typed or sent.",
    { url: z.string().max(2000).describe('The apply link, as read_job gave it') },
    ({ url }) =>
      guarded(async () => {
        const target = url.trim()
        if (!/^https?:\/\//i.test(target)) return refuse('Give the full https link, as read_job gave it.')
        if (portalOf(target)) return refuse("That link is on a portal, not the company's own page: read it with the portal's read_job.")
        pages.tried.add(linkKey(target))
        await ctx.chrome.openPage(target)
        const landed = (await ctx.chrome.page().catch(() => ({ url: target }))).url
        pages.read.add(linkKey(target))
        pages.read.add(linkKey(landed))
        ctx.count('read')
        return say(`Landed on: ${cleanLink(landed)}\n${await readPage(ctx, 'page', 10_000, 0)}`)
      }),
  )
}
