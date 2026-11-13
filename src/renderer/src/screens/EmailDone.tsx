import type { JSX } from 'react'

import { ArrowCounterClockwiseIcon, ArrowRightIcon, ArrowSquareOutIcon, PencilSimpleIcon, PlusIcon, TableIcon } from '@phosphor-icons/react'

import type { EmailChange, EmailWaiting } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { duration } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, ErrorNote, Group, Hidden, Loading, Numbers, Page, RunStatusBadge, StatusBadge } from '../ui/common'
import { Alert, AlertContent, AlertDescription, Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/nx'

const HOVER = 'nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity'
const openEmail = (link: string): Promise<void | undefined> => attempt(() => api.chrome.openUrl(link))

function Change({ change }: { change: EmailChange }): JSX.Element {
  if (change.from === change.to) {
    return (
      <Badge variant="secondary" fill="light" isCaps={false}>
        Note added
      </Badge>
    )
  }
  return (
    <span className="nx:flex nx:items-center nx:gap-1">
      <StatusBadge status={change.from} />
      <ArrowRightIcon size={12} />
      <StatusBadge status={change.to} />
      {change.undone && (
        <Badge variant="warning" fill="light" isCaps={false}>
          Undone
        </Badge>
      )}
    </span>
  )
}

function ChangeRow({ change }: { change: EmailChange }): JSX.Element {
  const canUndo = !change.undone && change.from !== change.to
  return (
    <TableRow className="nx:group">
      <TableCell>
        <button
          type="button"
          className="nx:flex nx:flex-col nx:max-w-[220px] nx:text-left nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer"
          onClick={() => go(change.kind === 'row' ? `/opportunity/${change.targetId}` : '/contacts')}
        >
          <span className="nx:typography-label-default nx:text-foreground nx:whitespace-nowrap">{change.title}</span>
          <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{change.subtitle}</span>
        </button>
      </TableCell>
      <TableCell>
        <Change change={change} />
      </TableCell>
      <TableCell>
        <div className="nx:flex nx:flex-col nx:max-w-[280px]" title={change.note}>
          <span className="nx:typography-body-small nx:truncate">{change.email.subject}</span>
          <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">
            {change.email.from} · {change.email.date}
          </span>
        </div>
      </TableCell>
      <TableCell className="nx:text-end">
        <div className={`nx:flex nx:items-center nx:justify-end nx:gap-1 ${HOVER}`}>
          {change.kind === 'contact' && change.to === 'referred' && !change.undone && (
            <Button variant="outline" size="sm" startIcon={<PencilSimpleIcon />} onClick={() => go(`/contacts/${change.targetId}/thanks`)}>
              Draft thanks
            </Button>
          )}
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

function Waiting({ job }: { job: EmailWaiting }): JSX.Element {
  const add = async (): Promise<void> => {
    const rowId = await attempt(() => api.email.add(job.id), `${job.company} added to the tracker`)
    if (rowId) go(`/opportunity/${rowId}`)
  }
  return (
    <div className="nx:flex nx:items-center nx:gap-3 nx:px-4 nx:py-3 nx:border-b-default nx:border-border-default nx:last:border-b-0">
      <div className="nx:flex nx:flex-col nx:flex-1 nx:min-w-0">
        <span className="nx:typography-label-default">
          {job.company}, {job.role}
        </span>
        <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{job.summary}</span>
      </div>
      <Button variant="outline" size="sm" startIcon={<PlusIcon />} onClick={() => void add()}>
        Add job
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void attempt(() => api.email.ignore(job.id))}>
        Ignore
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Open the email" onClick={() => void openEmail(job.email.link)}>
        <ArrowSquareOutIcon />
      </Button>
    </div>
  )
}

/** One email check's result: every change with the email behind it, and the jobs it kept for you. */
export function EmailDone({ runId }: { runId: number }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.email.detail(runId), [runId], ['email', 'runs', 'opportunities', 'contacts'])
  const crumbs = [{ label: 'Tracker', to: '/tracker' }]

  if (detail.error) return <Page title="Update from Gmail" crumbs={crumbs}><ErrorNote text={detail.error} /></Page>
  if (!detail.data) return <Page title="Update from Gmail" crumbs={crumbs}>{detail.isLoading ? <Loading /> : <ErrorNote text="There is no email check with that number." />}</Page>

  const { run, listed, opened, changes, waiting } = detail.data
  const isRunning = status?.run?.id === run.id && (status.run.status === 'running' || status.run.status === 'waiting')
  const moved = changes.filter(change => change.kind === 'row' && change.from !== change.to && !change.undone).length
  const contacts = changes.filter(change => change.kind === 'contact' && !change.undone).length
  const pending = waiting.filter(job => job.state === 'waiting')

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
              {moved} {moved === 1 ? 'job' : 'jobs'}
              {contacts ? ` and ${contacts} ${contacts === 1 ? 'contact' : 'contacts'}` : ''} moved on
            </span>,
            ...(pending.length ? [`${pending.length} waiting for you`] : []),
            `${opened} of ${listed} about your search`,
            ...(listed - opened > 0 ? [`${listed - opened} left unopened`] : []),
          ]}
        />
        <Group title="What changed">
          {changes.length === 0 ? (
            <span className="nx:typography-body-small nx:text-muted-foreground">Nothing in these emails moved a job on.</span>
          ) : (
            <Table aria-label="What changed" density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
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
        {pending.length > 0 && (
          <Group title="Waiting for you">
            <div className="nx:rounded-md nx:border-default nx:border-border-default nx:overflow-hidden">
              {pending.map(job => (
                <Waiting key={job.id} job={job} />
              ))}
            </div>
          </Group>
        )}
      </div>
    </Page>
  )
}

