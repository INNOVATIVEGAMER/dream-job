import type { HuntWindow, Portal } from '../../shared/types'
import type { ApplyRecord } from '../browser/tools'
import type { AnyTool, RunContext } from '../runs/engine'
import { instahyreTools, jobLink as instahyreLink } from './instahyre'
import { jobUrl as linkedinLink, linkedinTools } from './linkedin'
import { wellfoundTools } from './wellfound'

export type HuntHooks = {
  window: HuntWindow
  /** Each search run (null for a later page of one already counted), with the new postings it found as portal:id. */
  onSearch: (search: string | null, postings: string[]) => void
}

/** A portal's find tools, for the hunt. */
export function huntTools(ctx: RunContext, portal: Portal, hunt: HuntHooks): AnyTool[] {
  switch (portal) {
    case 'linkedin':
      return linkedinTools(ctx, { hunt })
    case 'wellfound':
      return wellfoundTools(ctx, { hunt })
    case 'instahyre':
      return instahyreTools(ctx, { hunt })
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
  }
}

/** A posting's link from its portal and job id, where the id alone makes one. Wellfound's needs its slug. */
export function postingLink(portal: Portal, jobId: string): string | null {
  if (portal === 'linkedin') return linkedinLink(jobId)
  if (portal === 'instahyre') return instahyreLink(jobId)
  return null
}
