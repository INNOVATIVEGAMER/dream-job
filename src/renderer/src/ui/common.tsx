import { Fragment } from 'react'
import type { JSX, ReactNode } from 'react'

import { InfoIcon, WarningIcon } from '@phosphor-icons/react'

import type { RunStatus } from '../../../shared/types'
import { messageOf } from '../lib/api'
import { go } from '../lib/router'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  SidebarTrigger,
  Spinner,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './nx'

export type Crumb = { label: string; to: string }

/** The slim bar every screen starts with: the sidebar toggle, where you are, and the screen's actions. */
export function TopBar({ left, right }: { left: ReactNode; right?: ReactNode }): JSX.Element {
  return (
    <header className="nx:flex nx:items-center nx:gap-2 nx:min-h-12 nx:box-border nx:px-4 nx:py-2 nx:border-b-default nx:border-border-default">
      <SidebarTrigger aria-label="Show or hide the sidebar" />
      <div className="nx:flex nx:flex-1 nx:min-w-0 nx:items-center nx:gap-2">{left}</div>
      {right && <div className="nx:flex nx:items-center nx:gap-2">{right}</div>}
    </header>
  )
}

/** Where a screen sits, as a trail of links ending in the screen itself. */
export function Trail({ crumbs, current }: { crumbs: Crumb[]; current: ReactNode }): JSX.Element {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map(crumb => (
          <Fragment key={crumb.to}>
            <BreadcrumbItem>
              <BreadcrumbLink
                href={`#${crumb.to}`}
                onClick={event => {
                  event.preventDefault()
                  go(crumb.to)
                }}
              >
                <span>{crumb.label}</span>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </Fragment>
        ))}
        <BreadcrumbItem>
          <BreadcrumbPage>
            <span>{current}</span>
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/**
 * One screen: its top bar, then the content. A title and at most a short
 * meta line, never a description. `layout` is `page` for padded content,
 * `list` for a list that runs edge to edge, `bare` for a screen that lays
 * itself out (a detail page, a run).
 */
export function Page(props: {
  title: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  crumbs?: Crumb[]
  /** Older screens name the screen they came from; shown as a one-step trail. */
  back?: Crumb
  narrow?: boolean
  layout?: 'page' | 'list' | 'bare'
  children: ReactNode
}): JSX.Element {
  const crumbs = props.crumbs ?? (props.back ? [props.back] : [])
  const left = crumbs.length ? (
    <>
      <Trail crumbs={crumbs} current={props.title} />
      {props.badge}
      {props.meta && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{props.meta}</span>}
    </>
  ) : (
    <>
      {props.badge}
      <span className="nx:typography-label-default nx:truncate">{props.title}</span>
      {props.meta && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{props.meta}</span>}
    </>
  )
  const layout = props.layout ?? 'page'
  return (
    <>
      <TopBar left={left} right={props.actions} />
      {layout === 'page' ? (
        <main className="nx:box-border nx:w-full nx:px-10 nx:py-8">
          <div className={`nx:mx-auto nx:flex nx:flex-col nx:gap-8 ${props.narrow ? 'nx:max-w-[760px]' : 'nx:max-w-[1120px]'}`}>{props.children}</div>
        </main>
      ) : (
        <main className="nx:box-border nx:w-full nx:flex nx:flex-col nx:flex-1 nx:min-h-0">{props.children}</main>
      )}
    </>
  )
}

/** A detail screen: the main column, and a properties panel on the right. */
export function DetailLayout({ main, panel }: { main: ReactNode; panel: ReactNode }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-1 nx:items-stretch nx:min-h-0">
      <div className="nx:flex-1 nx:min-w-0 nx:px-10 nx:py-8">
        <div className="nx:max-w-[720px] nx:flex nx:flex-col nx:gap-8">{main}</div>
      </div>
      <aside aria-label="Properties" className="nx:w-[300px] nx:shrink-0 nx:box-border nx:px-5 nx:py-6 nx:border-l-default nx:border-border-default nx:flex nx:flex-col nx:gap-6">
        {panel}
      </aside>
    </div>
  )
}

/** A quiet section: a small caps label, an optional action on the right, then its content. */
export function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="nx:flex nx:flex-col nx:gap-2">
      <div className="nx:flex nx:items-center nx:justify-between nx:gap-2 nx:min-h-8">
        <span className="nx:typography-label-caps nx:text-muted-foreground">{title}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Properties as label and value, one per line. */
export function Props({ items }: { items: [string, ReactNode][] }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-col nx:gap-1">
      {items.map(([label, value]) => (
        <div key={label} className="nx:grid nx:items-center nx:gap-2 nx:min-h-8" style={{ gridTemplateColumns: '96px minmax(0, 1fr)' }}>
          <span className="nx:typography-body-small nx:text-muted-foreground">{label}</span>
          <div className="nx:min-w-0 nx:typography-body-small">{value}</div>
        </div>
      ))}
    </div>
  )
}

/** An (i) that explains a choice in a tooltip, in place of a sentence on the screen. */
export function Tip({ text }: { text: string }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={text} className="nx:inline-flex nx:text-muted-foreground nx:cursor-help">
          <InfoIcon size={14} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}

/** Small numbers in a line: "8 added · 30 discarded". */
export function Numbers({ items }: { items: ReactNode[] }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-wrap nx:items-center nx:gap-2 nx:typography-body-small nx:text-muted-foreground">
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span>·</span>}
          <span>{item}</span>
        </Fragment>
      ))}
    </div>
  )
}

const STATUS_VARIANT: Record<string, 'information' | 'default' | 'success' | 'error' | 'secondary' | 'warning'> = {
  found: 'information',
  applied: 'default',
  outreach: 'default',
  replied: 'success',
  screen: 'success',
  onsite: 'success',
  offer: 'success',
  rejected: 'error',
  dead: 'secondary',
}

/** An opportunity's status as a badge: colour and word together. */
export function StatusBadge({ status }: { status: string }): JSX.Element {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'secondary'} fill="light" isCaps={false}>
      {status[0]?.toUpperCase() + status.slice(1)}
    </Badge>
  )
}

const RUN_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

export function RunStatusBadge({ status }: { status: RunStatus }): JSX.Element {
  const variant = status === 'done' ? 'success' : status === 'failed' ? 'error' : status === 'waiting' ? 'warning' : status === 'running' ? 'information' : 'secondary'
  return (
    <Badge variant={variant} fill="light" isCaps={false} leftIcon={status === 'running' ? <Spinner /> : undefined}>
      {RUN_LABEL[status]}
    </Badge>
  )
}

export function Loading({ label = 'Loading...' }: { label?: string }): JSX.Element {
  return (
    <div className="nx:flex nx:items-center nx:gap-2 nx:text-muted-foreground nx:typography-body-small">
      <Spinner /> {label}
    </div>
  )
}

export function ErrorNote({ text }: { text: string }): JSX.Element {
  return (
    <Alert variant="destructive" layout="inline">
      <AlertIcon>
        <WarningIcon />
      </AlertIcon>
      <AlertContent>
        <AlertDescription>{text}</AlertDescription>
      </AlertContent>
    </Alert>
  )
}

/** Runs an action, toasting its failure in plain words, and its success when one is given. */
export async function attempt<T>(work: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const result = await work()
    if (success) toast.success(success)
    return result
  } catch (error) {
    toast.error(messageOf(error))
    return undefined
  }
}

/** A visually hidden label, for icon-only columns. */
export function Hidden({ children }: { children: ReactNode }): JSX.Element {
  return <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{children}</span>
}
