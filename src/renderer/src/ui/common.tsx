import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

import { CaretLeftIcon, CheckCircleIcon, CircleIcon, WarningIcon, XIcon } from '@phosphor-icons/react'

import type { RunEvent, RunStatus } from '../../../shared/types'
import { messageOf } from '../lib/api'
import { go } from '../lib/router'
import { time } from '../lib/format'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Badge,
  Button,
  Input,
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderMeta,
  PageHeaderTitle,
  PageHeaderTitleRow,
  Spinner,
  toast,
} from './nx'

/** One screen's frame: an optional way back, the page header, then the content. */
export function Page(props: {
  title: ReactNode
  meta?: ReactNode
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  back?: { label: string; to: string }
  narrow?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <main
      className={`nx:box-border nx:w-full nx:mx-auto nx:px-6 nx:py-6 nx:flex nx:flex-col nx:gap-6 ${props.narrow ? 'nx:max-w-[820px]' : 'nx:max-w-[1120px]'}`}
    >
      {props.back && (
        <div>
          <Button variant="ghost" size="sm" startIcon={<CaretLeftIcon />} onClick={() => go(props.back!.to)}>
            {props.back.label}
          </Button>
        </div>
      )}
      <PageHeader>
        <PageHeaderContent>
          {props.meta && <PageHeaderMeta>{props.meta}</PageHeaderMeta>}
          {props.badge ? (
            <PageHeaderTitleRow>
              <PageHeaderTitle className="nx:typography-heading-large">{props.title}</PageHeaderTitle>
              {props.badge}
            </PageHeaderTitleRow>
          ) : (
            <PageHeaderTitle className="nx:typography-heading-large">{props.title}</PageHeaderTitle>
          )}
          {props.description && <PageHeaderDescription>{props.description}</PageHeaderDescription>}
        </PageHeaderContent>
        {props.actions && <PageHeaderActions>{props.actions}</PageHeaderActions>}
      </PageHeader>
      {props.children}
    </main>
  )
}

/** Two columns that stack on a narrow window: the main column, then a side column. */
export function Columns({ main, side }: { main: ReactNode; side: ReactNode }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-wrap nx:gap-6 nx:items-start">
      <div className="nx:flex nx:flex-col nx:gap-6 nx:min-w-0" style={{ flex: '999 1 560px' }}>
        {main}
      </div>
      <div className="nx:flex nx:flex-col nx:gap-6 nx:min-w-0" style={{ flex: '1 1 300px' }}>
        {side}
      </div>
    </div>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="nx:flex nx:flex-col nx:gap-3">
      <div className="nx:flex nx:items-center nx:justify-between nx:gap-2">
        <h2 className="nx:typography-heading-small nx:m-0">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function StatTile({ value, label, onClick }: { value: ReactNode; label: string; onClick?: () => void }): JSX.Element {
  const body = (
    <>
      <span className="nx:typography-heading-medium">{value}</span>
      <span className="nx:typography-body-small nx:text-muted-foreground">{label}</span>
    </>
  )
  const className =
    'nx:flex nx:flex-col nx:gap-1 nx:p-3 nx:text-left nx:rounded-md nx:border-default nx:border-border-default nx:bg-container nx:text-container-foreground'
  return onClick ? (
    <button type="button" className={`${className} nx:cursor-pointer`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function Tiles({ children }: { children: ReactNode }): JSX.Element {
  return <div className="nx:grid nx:gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>{children}</div>
}

const EVENT_COLOR: Record<RunEvent['kind'], string> = {
  step: '',
  claude: 'nx:text-muted-foreground',
  tool: '',
  good: 'nx:text-success-subtle-foreground',
  warn: 'nx:text-warning-subtle-foreground',
  error: 'nx:text-error-subtle-foreground',
}

/** A run's activity, oldest first, newest at the bottom. */
export function Activity({ events, limit = 40 }: { events: RunEvent[]; limit?: number }): JSX.Element {
  const shown = events.slice(-limit)
  if (shown.length === 0) return <p className="nx:typography-body-small nx:text-muted-foreground nx:m-0">Nothing yet.</p>
  return (
    <ol className="nx:typography-body-small nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-2">
      {shown.map(event => (
        <li key={event.id} className="nx:flex nx:gap-2">
          <span className="nx:text-muted-foreground nx:tabular-nums nx:shrink-0">{time(event.at)}</span>
          <span className={EVENT_COLOR[event.kind]}>{event.text}</span>
        </li>
      ))}
    </ol>
  )
}

export type Check = { state: 'ok' | 'warn' | 'todo'; text: ReactNode }

export function CheckList({ items }: { items: Check[] }): JSX.Element {
  return (
    <ul className="nx:typography-body-small nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-2">
      {items.map((item, i) => (
        <li key={i} className="nx:flex nx:gap-2 nx:items-center">
          {item.state === 'ok' ? <CheckCircleIcon size={16} /> : item.state === 'warn' ? <WarningIcon size={16} /> : <CircleIcon size={16} />}
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
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

/** Values shown as removable chips. */
export function Chips({ values, onRemove }: { values: string[]; onRemove?: (value: string) => void }): JSX.Element | null {
  if (values.length === 0) return null
  return (
    <div className="nx:flex nx:flex-wrap nx:gap-2">
      {values.map(value => (
        <Badge
          key={value}
          variant="secondary"
          fill="outline"
          isCaps={false}
          rightIcon={
            onRemove ? (
              <button type="button" aria-label={`Remove ${value}`} className="nx:inline-flex nx:cursor-pointer nx:bg-transparent nx:border-0 nx:p-0" onClick={() => onRemove(value)}>
                <XIcon size={12} />
              </button>
            ) : undefined
          }
        >
          {value}
        </Badge>
      ))}
    </div>
  )
}

/** A list edited as chips: type and press Enter to add. */
export function ChipsInput(props: { id?: string; values: string[]; onChange: (values: string[]) => void; placeholder: string }): JSX.Element {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const value = draft.trim()
    if (value && !props.values.some(one => one.toLowerCase() === value.toLowerCase())) props.onChange([...props.values, value])
    setDraft('')
  }
  return (
    <div className="nx:flex nx:flex-col nx:gap-2">
      <Chips values={props.values} onRemove={value => props.onChange(props.values.filter(one => one !== value))} />
      <Input
        id={props.id}
        value={draft}
        placeholder={props.placeholder}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
    </div>
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

export function Muted({ children }: { children: ReactNode }): JSX.Element {
  return <span className="nx:typography-body-small nx:text-muted-foreground">{children}</span>
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
