import type { JSX } from 'react'

import { ArrowCounterClockwiseIcon, ArrowRightIcon, ArrowSquareOutIcon, TableIcon } from '@phosphor-icons/react'

import type { EmailChange } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { duration, plural, tokens } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, ErrorNote, Group, Hidden, Loading, Numbers, Page, RunStatusBadge, StatusBadge } from '../ui/common'
import { Alert, AlertContent, AlertDescription, Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/nx'

const HOVER = 'nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity'
const openEmail = (link: string): Promise<void | undefined> => attempt(() => api.chrome.openUrl(link))

/** A note leaves the status as it was; a move shows where from and where to. */
const isMove = (change: EmailChange): boolean => change.from !== change.to

function Change({ change }: { change: EmailChange }): JSX.Element {
  return (
    <span className="nx:flex nx:items-center nx:gap-1">
      {isMove(change) ? (
        <>
          <StatusBadge status={change.from} />
          <ArrowRightIcon size={12} />
          <StatusBadge status={change.to} />
        </>
      ) : (
        <Badge variant="secondary" fill="light" isCaps={false}>
          Note added
        </Badge>
      )}
      {change.undone && (
        <Badge variant="warning" fill="light" isCaps={false}>
          Undone
        </Badge>
      )}
    </span>
  )
}

/** A job opens its page; a person has no page of their own, so their line stays text. */
function Who({ change }: { change: EmailChange }): JSX.Element {
  const text = (
    <>
      <span className="nx:typography-label-default nx:text-foreground nx:whitespace-nowrap">{change.title}</span>
      <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{change.subtitle}</span>
    </>
  )
  if (change.kind !== 'job') return <div className="nx:flex nx:flex-col nx:max-w-[220px]">{text}</div>
  return (
    <button type="button" className="nx:flex nx:flex-col nx:max-w-[220px] nx:text-left nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer" onClick={() => go(`/job/${change.targetId}`)}>
      {text}
    </button>
  )
}

function ChangeRow({ change }: { change: EmailChange }): JSX.Element {
  const canUndo = !change.undone && isMove(change)
  return (
    <TableRow className="nx:group">
      <TableCell>
        <Who change={change} />
      </TableCell>
      <TableCell>
        <Change change={change} />
      </TableCell>
      <TableCell>
        <div className="nx:flex nx:flex-col nx:max-w-[280px]" title={change.note || undefined}>
          <span className="nx:typography-body-small nx:truncate">{change.email.subject}</span>
          <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">
            {change.email.from} · {change.email.date}
          </span>
        </div>
      </TableCell>
      <TableCell className="nx:text-end">
        <div className={`nx:flex nx:items-center nx:justify-end nx:gap-1 ${HOVER}`}>
          <Button variant="ghost" size="icon-sm" aria-label="Open the email" onClick={() => void openEmail(change.email.link)}>
            <ArrowSquareOutIcon />
          </Button>
          {canUndo && (
            <Button variant="ghost" size="icon-sm" aria-label={`Undo the change to ${change.title}`} onClick={() => void attempt(() => api.email.undo(change.id), 'Put back as it was')}>
              <ArrowCounterClockwiseIcon />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

/** "4 jobs and 1 person moved on", or that nothing did. */
function movedLine(jobs: number, people: number): string {
  if (!jobs && !people) return 'Nothing moved on'
  const parts = [jobs ? plural(jobs, 'job') : '', people ? plural(people, 'person', 'people') : ''].filter(Boolean)
  return `${parts.join(' and ')} moved on`
}

/** One email check's result: every change with the email behind it, each one undoable. */
export function EmailDone({ runId }: { runId: number }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.email.detail(runId), [runId], ['email', 'runs', 'jobs', 'people'])
  const crumbs = [{ label: 'Tracker', to: '/tracker' }]

  if (detail.error) return <Page title="Update from Gmail" crumbs={crumbs}><ErrorNote text={detail.error} /></Page>
  if (!detail.data) return <Page title="Update from Gmail" crumbs={crumbs}>{detail.isLoading ? <Loading /> : <ErrorNote text="There is no email check with that number." />}</Page>

  const { run, listed, matched, changes } = detail.data
  const isRunning = status?.run?.id === run.id && (status.run.status === 'running' || status.run.status === 'waiting')
  const live = changes.filter(change => isMove(change) && !change.undone)
  const jobs = new Set(live.filter(change => change.kind === 'job').map(change => change.targetId)).size
  const people = new Set(live.filter(change => change.kind === 'person').map(change => change.targetId)).size
  const usage = [run.usage.ms ? duration(run.usage.ms) : '', run.usage.turns ? `${run.usage.turns} turns` : '', run.usage.inputTokens ? `${tokens(run.usage.inputTokens)} tokens` : ''].filter(Boolean)

  return (
    <Page
      title="Update from Gmail"
      crumbs={crumbs}
      badge={<RunStatusBadge status={run.status} />}
      meta={`Run ${run.id}${run.usage.ms ? ` · ${duration(run.usage.ms)}` : ''}`}
      actions={
        <Button variant="outline" size="sm" startIcon={<TableIcon />} onClick={() => go('/tracker')}>
          Open tracker
        </Button>
      }
    >
      <div className="nx:max-w-[980px] nx:flex nx:flex-col nx:gap-8">
        {isRunning && (
          <Alert variant="information" layout="inline">
            <AlertContent>
              <AlertDescription>Still running. Changes appear as they are made.</AlertDescription>
            </AlertContent>
            <Button variant="outline" size="sm" onClick={() => go('/run')}>
              Watch it
            </Button>
          </Alert>
        )}
        <Numbers
          items={[
            <span key="moved" className="nx:typography-label-default nx:text-foreground">
              {movedLine(jobs, people)}
            </span>,
            `${matched} of ${listed} about jobs and people you track`,
          ]}
        />
        <Group title="What changed">
          {changes.length === 0 ? (
            <span className="nx:typography-body-small nx:text-muted-foreground">Nothing in these emails moved a job or a person on.</span>
          ) : (
            <Table aria-label="What changed" density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Job or person</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>
                    <Hidden>Actions</Hidden>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map(change => (
                  <ChangeRow key={change.id} change={change} />
                ))}
              </TableBody>
            </Table>
          )}
        </Group>
        <span className="nx:typography-body-small nx:text-muted-foreground">The check only moves jobs and people you already track. It never adds a job.</span>
        {usage.length > 0 && <span className="nx:typography-body-small nx:text-muted-foreground">{usage.join(' · ')}</span>}
      </div>
    </Page>
  )
}
