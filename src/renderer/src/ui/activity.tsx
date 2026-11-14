import type { JSX } from 'react'

import {
  ArchiveIcon,
  ChatTextIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  NoteIcon,
  PaperPlaneTiltIcon,
  SignInIcon,
  SignOutIcon,
  UserCheckIcon,
  UserPlusIcon,
  XCircleIcon,
} from '@phosphor-icons/react'

import type { Activity } from '../../../shared/types'
import { when } from '../lib/format'

/** A status change's mark, by where the job went. */
function statusIcon(to: string | null): JSX.Element {
  if (to === 'found') return <MagnifyingGlassIcon size={14} />
  if (to === 'applied') return <PaperPlaneTiltIcon size={14} />
  if (to === 'outreached') return <ChatTextIcon size={14} />
  if (to === 'discarded') return <ArchiveIcon size={14} />
  if (to === 'rejected' || to === 'dead') return <XCircleIcon size={14} />
  return <CheckCircleIcon size={14} />
}

function iconOf(row: Activity): JSX.Element {
  switch (row.kind) {
    case 'status':
      return statusIcon(row.toState)
    case 'request-sent':
      return <UserPlusIcon size={14} />
    case 'connected':
      return <UserCheckIcon size={14} />
    case 'outreach':
      return <ChatTextIcon size={14} />
    case 'joined':
      return <SignInIcon size={14} />
    case 'left':
      return <SignOutIcon size={14} />
    case 'note':
      return <NoteIcon size={14} />
  }
}

/** What happened, newest first: one line each, with when. An undone line stays, struck through. */
export function ActivityTimeline({ activity }: { activity: Activity[] }): JSX.Element {
  if (activity.length === 0) return <span className="nx:typography-body-small nx:text-muted-foreground">Nothing yet.</span>
  return (
    <ol className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col">
      {activity.map(row => (
        <li key={row.id} className="nx:flex nx:items-center nx:gap-2 nx:min-h-7">
          <span className="nx:inline-flex nx:text-muted-foreground">{iconOf(row)}</span>
          <span className={`nx:typography-body-small nx:flex-1 nx:min-w-0 ${row.undone ? 'nx:line-through nx:text-muted-foreground' : ''}`} title={row.undone ? 'Undone' : undefined}>
            {row.text}
          </span>
          <span className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">{when(row.at)}</span>
        </li>
      ))}
    </ol>
  )
}
