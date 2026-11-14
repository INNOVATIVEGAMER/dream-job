import type { HuntWindow, Portal } from '../../shared/types'
import type { ApplyRecord } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import type { OnRead } from './common'
import { instahyreTools, jobLink as instahyreLink } from './instahyre'
import { jobLink as jsgurujobsLink, jsgurujobsTools } from './jsgurujobs'
import { jobUrl as linkedinLink, linkedinTools } from './linkedin'
import { onlyfrontendjobsTools } from './onlyfrontendjobs'
import { weekdayTools } from './weekday'
import { wellfoundTools } from './wellfound'
import { jobLink as workatastartupLink, workatastartupTools } from './workatastartup'

export type HuntHooks = {
  window: HuntWindow
  /** Each search run (null for a later page of one already counted), with the new postings it found as portal:id. */
  onSearch: (search: string | null, postings: string[]) => void
}

/** A portal's find tools, for the hunt. `onRead` hears what each read_job saw on the page. */
export function huntTools(ctx: RunContext, portal: Portal, hunt: HuntHooks, onRead?: OnRead): AnyTool[] {
  switch (portal) {
    case 'linkedin':
      return linkedinTools(ctx, { hunt, onRead })
    case 'wellfound':
      return wellfoundTools(ctx, { hunt, onRead })
    case 'instahyre':
      return instahyreTools(ctx, { hunt, onRead })
    case 'jsgurujobs':
      return jsgurujobsTools(ctx, { hunt, onRead })
    case 'onlyfrontendjobs':
      return onlyfrontendjobsTools(ctx, { hunt, onRead })
    case 'workatastartup':
      return workatastartupTools(ctx, { hunt, onRead })
    case 'weekday':
      return weekdayTools(ctx, { hunt, onRead })
  }
}

/** A portal's read and apply tools, for applying to one of its postings. */
export function applyTools(ctx: RunContext, portal: Portal, record: ApplyRecord): AnyTool[] {
  switch (portal) {
    case 'linkedin':
      return linkedinTools(ctx, { apply: record })
    case 'wellfound':
      return wellfoundTools(ctx, { apply: record })
    case 'instahyre':
      return instahyreTools(ctx, { apply: record })
    case 'jsgurujobs':
      return jsgurujobsTools(ctx, { apply: record })
    case 'onlyfrontendjobs':
      return onlyfrontendjobsTools(ctx, { apply: record })
    case 'workatastartup':
      return workatastartupTools(ctx, { apply: record })
    case 'weekday':
      return weekdayTools(ctx, { apply: record })
  }
}

/**
 * How each portal's read_job finds a posting: by its job id alone, or by
 * the posting's link, whose path carries a slug the id can't rebuild.
 */
export const READ_BY: Record<Portal, 'id' | 'link'> = {
  linkedin: 'id',
  instahyre: 'id',
  jsgurujobs: 'id',
  workatastartup: 'id',
  wellfound: 'link',
  onlyfrontendjobs: 'link',
  weekday: 'link',
}

/**
 * A posting's id on its portal, read back from the posting link the app
 * built from it: for the portals whose read_job finds a posting by id.
 */
export function portalIdOf(portal: Portal, portalLink: string | null | undefined): string | null {
  if (!portalLink || READ_BY[portal] !== 'id') return null
  const patterns: Partial<Record<Portal, RegExp>> = {
    linkedin: /\/jobs\/view\/(\d+)/,
    instahyre: /\/job-([^/?#]+)/,
    jsgurujobs: /\/jobs\/([^/?#]+)/,
    workatastartup: /\/jobs\/([^/?#]+)/,
  }
  return portalLink.match(patterns[portal] ?? /$^/)?.[1] ?? null
}

/** A posting's link from its portal and job id, where the id alone makes one. */
export function postingLink(portal: Portal, jobId: string): string | null {
  switch (portal) {
    case 'linkedin':
      return linkedinLink(jobId)
    case 'instahyre':
      return instahyreLink(jobId)
    case 'jsgurujobs':
      return jsgurujobsLink(jobId)
    case 'workatastartup':
      return workatastartupLink(jobId)
    default:
      return null
  }
}
