import type { JSX } from 'react'

import { ArrowCounterClockwiseIcon, ArrowRightIcon, ArrowSquareOutIcon, EnvelopeIcon, PencilSimpleIcon, PlusIcon, TableIcon } from '@phosphor-icons/react'

import type { EmailChange, EmailWaiting } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { capitalize, duration, plural, time, tokens } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Columns, ErrorNote, Hidden, Loading, Page, RunStatusBadge, Section, StatTile, StatusBadge, Tiles } from '../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

const openEmail = (link: string): Promise<void | undefined> => attempt(() => api.chrome.openUrl(link))

function Change({ change }: { change: EmailChange }): JSX.Element {
  const isNote = change.from === change.to
  return (
    <div className="nx:flex nx:flex-col nx:gap-1">
      <div className="nx:flex nx:flex-wrap nx:items-center nx:gap-1">
        {isNote ? (
          <Badge variant="secondary" fill="light" isCaps={false}>
            Note added
          </Badge>
        ) : change.kind === 'row' ? (
          <>
            <StatusBadge status={change.from} />
            <ArrowRightIcon size={12} aria-hidden="true" />
            <StatusBadge status={change.to} />
          </>
        ) : (
          <>
            <Badge variant="secondary" fill="light" isCaps={false}>
              {capitalize(change.from)}
            </Badge>
            <ArrowRightIcon size={12} aria-hidden="true" />
            <Badge variant="success" fill="light" isCaps={false}>
              {capitalize(change.to)}
            </Badge>
          </>
        )}
        {change.undone && (
          <Badge variant="warning" fill="light" isCaps={false}>
            Undone
          </Badge>
        )}
      </div>
      <span className="nx:typography-body-small nx:text-muted-foreground">{change.note}</span>
    </div>
  )
}

function ChangeRow({ change }: { change: EmailChange }): JSX.Element {
  const canUndo = !change.undone && change.from !== change.to
  return (
    <TableRow>
      <TableCell>
        <button
          type="button"
          className="nx:flex nx:flex-col nx:text-left nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer"
          onClick={() => go(change.kind === 'row' ? `/opportunity/${change.targetId}` : '/contacts')}
        >
          <span className="nx:typography-label-default nx:text-foreground">{change.title}</span>
          <span className="nx:typography-body-small nx:text-muted-foreground">{change.subtitle}</span>
        </button>
      </TableCell>
      <TableCell>
        <Change change={change} />
      </TableCell>
      <TableCell>
        <div className="nx:flex nx:flex-col">
          <span className="nx:typography-label-default">{change.email.subject}</span>
          <span className="nx:typography-body-small nx:text-muted-foreground">
            {change.email.from}, {change.email.date}
          </span>
        </div>
      </TableCell>
      <TableCell className="nx:text-end nx:whitespace-nowrap">
        {change.kind === 'contact' && change.to === 'referred' && !change.undone && (
          <Button variant="outline" size="sm" startIcon={<PencilSimpleIcon />} onClick={() => go(`/contacts/${change.targetId}/thanks`)}>
            Draft thanks
          </Button>
        )}
        <Button variant="ghost" size="sm" endIcon={<ArrowSquareOutIcon />} onClick={() => void openEmail(change.email.link)}>
          Email
        </Button>
        {canUndo && (
          <Button variant="ghost" size="icon-sm" aria-label={`Undo the change to ${change.title}`} onClick={() => void attempt(() => api.email.undo(change.id), 'Put back as it was')}>
            <ArrowCounterClockwiseIcon />
          </Button>
        )}
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
    <div className="nx:flex nx:flex-col nx:gap-2 nx:pb-3 nx:border-b-default nx:border-border-default nx:last:border-b-0 nx:last:pb-0">
      <div className="nx:flex nx:flex-col nx:gap-1">
        <span className="nx:typography-label-default">
          {job.company}, {job.role}
        </span>
        <span className="nx:typography-body-small nx:text-muted-foreground">{job.summary}</span>
        <span className="nx:typography-body-small nx:text-muted-foreground">
          "{job.email.subject}", {job.email.date}
        </span>
      </div>
      <div className="nx:flex nx:flex-wrap nx:gap-2">
        <Button variant="outline" size="sm" startIcon={<PlusIcon />} onClick={() => void add()}>
          Add to tracker
        </Button>
        <Button variant="ghost" size="sm" endIcon={<ArrowSquareOutIcon />} onClick={() => void openEmail(job.email.link)}>
          Open email
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void attempt(() => api.email.ignore(job.id))}>
          Ignore
        </Button>
      </div>
    </div>
  )
}

/** One email check's result: every change it made with the email behind it, and the jobs it kept for you. */
export function EmailDone({ runId }: { runId: number }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.email.detail(runId), [runId], ['email', 'runs', 'opportunities', 'contacts'])

  if (detail.error) return <Page title="Update from Gmail"><ErrorNote text={detail.error} /></Page>
  if (detail.isLoading && !detail.data) return <Page title="Update from Gmail"><Loading /></Page>
  if (!detail.data) {
    return (
      <Page title="Update from Gmail" back={{ label: 'Tracker', to: '/tracker' }}>
        <span className="nx:typography-body-default nx:text-muted-foreground">There is no email check with that number.</span>
      </Page>
    )
  }

  const { run, listed, opened, changes, waiting } = detail.data
  const isRunning = status?.run?.id === run.id && (status.run.status === 'running' || status.run.status === 'waiting')
  const moved = changes.filter(change => change.kind === 'row' && change.from !== change.to && !change.undone).length
  const contacts = changes.filter(change => change.kind === 'contact' && !change.undone).length
  const pending = waiting.filter(job => job.state === 'waiting')

  return (
    <Page
      meta={`Run ${run.id}, ${time(run.started)}${run.ended ? ` to ${time(run.ended)}` : ''}`}
      title="Update from Gmail"
      badge={<RunStatusBadge status={run.status} />}
      description={run.result ?? undefined}
      back={{ label: 'Tracker', to: '/tracker' }}
      actions={
        <Button variant="outline" startIcon={<TableIcon />} onClick={() => go('/tracker')}>
          Open the tracker
        </Button>
      }
    >
      {isRunning && (
        <Alert variant="information" layout="inline">
          <AlertContent>
            <AlertDescription>This check is still running. Its changes appear here as they are made.</AlertDescription>
          </AlertContent>
          <Button variant="outline" size="sm" onClick={() => go('/run')}>
            Watch it
          </Button>
        </Alert>
      )}
      <Tiles>
        <StatTile value={listed} label="Emails listed" />
        <StatTile value={opened} label="About your job search" />
        <StatTile value={moved} label="Rows moved on" />
        {contacts > 0 && <StatTile value={contacts} label="Contacts moved on" />}
        <StatTile value={pending.length} label="Waiting for you" />
        {run.usage.ms > 0 && <StatTile value={duration(run.usage.ms)} label={`${run.usage.turns} turns, ${tokens(run.usage.inputTokens)} tokens in`} />}
      </Tiles>
      <Columns
        main={
          <Section title="What changed">
            {changes.length === 0 ? (
              <span className="nx:typography-body-small nx:text-muted-foreground">Nothing in these emails moved a row on.</span>
            ) : (
              <>
                <Table aria-label="Changes from email" density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>From the email</TableHead>
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
                <p className="nx:typography-body-small nx:m-0 nx:text-muted-foreground">Each change is in the row's history with its email. Undo puts the row back as it was.</p>
              </>
            )}
          </Section>
        }
        side={
          <>
            <Card>
              <CardHeader>
                <CardTitle>Waiting for you</CardTitle>
                <CardDescription>Emails about a job that is not in your tracker.</CardDescription>
              </CardHeader>
              <CardContent>
                {pending.length === 0 ? (
                  <span className="nx:typography-body-small nx:text-muted-foreground">Nothing waiting.</span>
                ) : (
                  <div className="nx:flex nx:flex-col nx:gap-3">
                    {pending.map(job => (
                      <Waiting key={job.id} job={job} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            {listed > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Left unopened</CardTitle>
                  <CardDescription>Claude did not open these.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="nx:flex nx:gap-2 nx:items-start nx:typography-body-small">
                    <EnvelopeIcon size={16} aria-hidden="true" />
                    <span>{plural(listed - opened, 'email')} that weren't about your job search, judged from sender and subject alone.</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        }
      />
    </Page>
  )
}
