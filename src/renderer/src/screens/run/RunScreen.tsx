import { useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, BrowserIcon, CheckCircleIcon, ClockIcon, InfoIcon, StopIcon, WarningIcon } from '@phosphor-icons/react'

import type { LaneStatus, RunLane, RunState } from '../../../../shared/types'
import { api } from '../../lib/api'
import { duration, portalName, time, tokens } from '../../lib/format'
import { go } from '../../lib/router'
import { useAppStatus } from '../../lib/status'
import { Activity, attempt, Columns, Hidden, Page, RunStatusBadge, Section, StatTile, Tiles } from '../../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListItem,
  DescriptionListTerm,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/nx'
import { RunCardView } from './Cards'

/** What each tally a run keeps is called on screen. */
const COUNT_LABELS: Record<string, string> = {
  added: 'Added as found',
  discarded: 'Discarded',
  skipped: 'Skipped: already tracked or never shown',
  read: 'Postings read',
  sent: 'Requests sent',
  accepted: 'Newly accepted',
  messaged: 'Messages sent',
  filled: 'Fields filled',
  listed: 'Emails listed',
  seen: 'Skipped: an earlier check read them',
  opened: 'About your job search',
  moved: 'Rows moved on',
  contacts: 'Contacts moved on',
  waiting: 'Waiting for you',
}

const isActive = (status: LaneStatus): boolean => status === 'running' || status === 'waiting'

function Result({ run }: { run: RunState }): JSX.Element | null {
  if (run.status === 'running' || run.status === 'waiting' || !run.result) return null
  const isDone = run.status === 'done'
  return (
    <Alert variant={isDone ? 'success' : run.status === 'failed' ? 'destructive' : 'default'} layout="inline">
      <AlertIcon>{isDone ? <CheckCircleIcon /> : run.status === 'failed' ? <WarningIcon /> : <InfoIcon />}</AlertIcon>
      <AlertContent>
        <AlertTitle>{isDone ? 'Done' : run.status === 'failed' ? 'The run failed' : 'Stopped'}</AlertTitle>
        <AlertDescription>{run.result}</AlertDescription>
      </AlertContent>
    </Alert>
  )
}

function ProgressBar({ label, done, total }: { label: string; done: number; total: number }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-col nx:gap-2">
      <div className="nx:flex nx:justify-between nx:gap-2">
        <span className="nx:typography-label-default">{label}</span>
        <span className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">
          {done} of {total}
        </span>
      </div>
      <Progress aria-label={label} value={total ? Math.round((done / total) * 100) : 0} />
    </div>
  )
}

function CountTiles({ run, extra }: { run: RunState; extra?: JSX.Element }): JSX.Element | null {
  const counts = Object.entries(run.counts).filter(([, n]) => n > 0)
  if (counts.length === 0 && !extra) return null
  return (
    <Tiles>
      {counts.map(([key, n]) => (
        <StatTile key={key} value={n} label={COUNT_LABELS[key] ?? key} />
      ))}
      {extra}
    </Tiles>
  )
}

function Usage({ run, isBusy }: { run: RunState; isBusy: boolean }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isBusy ? 'Usage so far' : 'Usage'}</CardTitle>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          {run.lanes.length > 1 && (
            <DescriptionListItem>
              <DescriptionListTerm>Sessions</DescriptionListTerm>
              <DescriptionListDescription>
                {run.lanes.length}, {run.atOnce} at a time
              </DescriptionListDescription>
            </DescriptionListItem>
          )}
          <DescriptionListItem>
            <DescriptionListTerm>Turns</DescriptionListTerm>
            <DescriptionListDescription>{run.usage.turns}</DescriptionListDescription>
          </DescriptionListItem>
          {run.usage.inputTokens > 0 && (
            <DescriptionListItem>
              <DescriptionListTerm>Tokens</DescriptionListTerm>
              <DescriptionListDescription>
                {tokens(run.usage.inputTokens)} in, {tokens(run.usage.outputTokens)} out
              </DescriptionListDescription>
            </DescriptionListItem>
          )}
          {run.usage.ms > 0 && (
            <DescriptionListItem>
              <DescriptionListTerm>Time</DescriptionListTerm>
              <DescriptionListDescription>{duration(run.usage.ms)}</DescriptionListDescription>
            </DescriptionListItem>
          )}
        </DescriptionList>
      </CardContent>
    </Card>
  )
}

/** One session's state as a badge: up next, working, waiting for you, or how it ended. */
function LaneBadge({ lane }: { lane: RunLane }): JSX.Element {
  if (lane.status === 'queued') {
    return (
      <Badge variant="secondary" fill="light" isCaps={false} leftIcon={<ClockIcon />}>
        Up next
      </Badge>
    )
  }
  return <RunStatusBadge status={lane.status} />
}

/** A session's tile: what it works on, where it stands, the last thing it did. Picking it shows its card and activity. */
function LaneTile({ lane, isPicked, onPick }: { lane: RunLane; isPicked: boolean; onPick: () => void }): JSX.Element {
  const isWaiting = lane.status === 'waiting'
  return (
    <button
      type="button"
      aria-pressed={isPicked}
      onClick={onPick}
      className={[
        'nx:flex nx:flex-col nx:gap-2 nx:min-w-0 nx:p-3 nx:text-left nx:cursor-pointer nx:rounded-md nx:border-default nx:text-foreground',
        isWaiting ? 'nx:border-warning-border nx:bg-warning-subtle' : 'nx:border-border-default nx:bg-container nx:hover:bg-container-hover',
        isPicked ? 'nx:outline-2 nx:outline-border-focus' : '',
      ].join(' ')}
    >
      <span className="nx:flex nx:flex-col nx:min-w-0">
        <span className="nx:typography-label-default nx:truncate">{lane.title}</span>
        {lane.subtitle && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{lane.subtitle}</span>}
      </span>
      <span>
        <LaneBadge lane={lane} />
      </span>
      {lane.progress && isActive(lane.status) && (
        <span className="nx:flex nx:flex-col nx:gap-1">
          <span className="nx:flex nx:justify-between nx:gap-2 nx:typography-body-small">
            <span className="nx:truncate">{lane.progress.label}</span>
            <span className="nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">
              {lane.progress.done} of {lane.progress.total}
            </span>
          </span>
          <Progress aria-label={`${lane.title}: ${lane.progress.label}`} value={lane.progress.total ? Math.round((lane.progress.done / lane.progress.total) * 100) : 0} />
        </span>
      )}
      <span className="nx:typography-body-small nx:text-muted-foreground nx:line-clamp-2">
        {lane.status === 'queued' ? 'Starts when a session frees up' : isActive(lane.status) ? (lane.last ?? 'Starting') : (lane.result ?? lane.last ?? '')}
      </span>
    </button>
  )
}

const showTab = (key: string): Promise<void | undefined> => attempt(() => api.runs.showTab(key))

/** The picked session: its card when it waits for you, what it is doing, and its own activity. */
function LaneDetail({ lane }: { lane: RunLane }): JSX.Element {
  const busy = isActive(lane.status)
  return (
    <>
      <div className="nx:flex nx:flex-wrap nx:items-end nx:justify-between nx:gap-2 nx:pt-2 nx:border-t-default nx:border-border-default">
        <div className="nx:flex nx:flex-col nx:min-w-0">
          <span className="nx:typography-label-default">{lane.title}</span>
          <span className="nx:typography-body-small nx:text-muted-foreground">
            {[lane.subtitle, lane.portal ? portalName(lane.portal) : null, lane.started ? `started ${time(lane.started)}` : null].filter(Boolean).join(', ')}
          </span>
        </div>
        <div className="nx:flex nx:flex-wrap nx:gap-2">
          {busy && (
            <Button variant="outline" size="sm" startIcon={<BrowserIcon />} onClick={() => void showTab(lane.key)}>
              Show its tab
            </Button>
          )}
          {lane.opportunityId && (
            <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go(`/opportunity/${lane.opportunityId}`)}>
              Open the row
            </Button>
          )}
        </div>
      </div>
      <Columns
        main={
          lane.card ? (
            <RunCardView card={lane.card} />
          ) : busy ? (
            <Card>
              <CardHeader>
                <CardTitle>Working in its own tab</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="nx:typography-body-small nx:text-muted-foreground">
                  This session works in a Chrome tab of its own, beside the others. Anything that needs you stops here on a card, and the other sessions carry on.
                </span>
              </CardContent>
            </Card>
          ) : lane.status === 'queued' ? (
            <Card>
              <CardHeader>
                <CardTitle>Up next</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="nx:typography-body-small nx:text-muted-foreground">It starts when one of the sessions running now finishes.</span>
              </CardContent>
            </Card>
          ) : (
            <Alert variant={lane.status === 'done' ? 'success' : lane.status === 'failed' ? 'destructive' : 'default'} layout="inline">
              <AlertIcon>{lane.status === 'done' ? <CheckCircleIcon /> : lane.status === 'failed' ? <WarningIcon /> : <InfoIcon />}</AlertIcon>
              <AlertContent>
                <AlertTitle>{lane.status === 'done' ? 'Done' : lane.status === 'failed' ? 'This session failed' : 'Stopped'}</AlertTitle>
                <AlertDescription>{lane.result}</AlertDescription>
              </AlertContent>
            </Alert>
          )
        }
        side={
          <Card>
            <CardHeader>
              <CardTitle>This session</CardTitle>
            </CardHeader>
            <CardContent>{lane.events.length ? <Activity events={lane.events} /> : <span className="nx:typography-body-small nx:text-muted-foreground">Nothing yet.</span>}</CardContent>
          </Card>
        }
      />
    </>
  )
}

const took = (lane: RunLane): string =>
  lane.started && lane.ended ? duration(new Date(lane.ended).getTime() - new Date(lane.started).getTime()) : ''

/** Once a run of several sessions ends: how each one went. */
function Outcomes({ run }: { run: RunState }): JSX.Element {
  return (
    <Table aria-label="How each session went" density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>Session</TableHead>
          <TableHead>Result</TableHead>
          <TableHead>How it went</TableHead>
          <TableHead>Took</TableHead>
          <TableHead>
            <Hidden>Actions</Hidden>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {run.lanes.map(lane => (
          <TableRow key={lane.key}>
            <TableCell>
              <div className="nx:flex nx:flex-col">
                <span className="nx:typography-label-default">{lane.title}</span>
                {lane.subtitle && <span className="nx:typography-body-small nx:text-muted-foreground">{lane.subtitle}</span>}
              </div>
            </TableCell>
            <TableCell>
              <LaneBadge lane={lane} />
            </TableCell>
            <TableCell>
              <span className="nx:typography-body-small">{lane.result}</span>
            </TableCell>
            <TableCell className="nx:tabular-nums nx:whitespace-nowrap">{took(lane)}</TableCell>
            <TableCell className="nx:text-end">
              {lane.opportunityId && (
                <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go(`/opportunity/${lane.opportunityId}`)}>
                  Open the row
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** A run of several sessions: one tile each, the picked one's card and activity, and how each ended. */
function ManyLanes({ run, isBusy }: { run: RunState; isBusy: boolean }): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)
  // Until you pick one, the first session waiting for you is shown, then the first one working.
  const lane =
    run.lanes.find(one => one.key === picked) ??
    run.lanes.find(one => one.status === 'waiting') ??
    run.lanes.find(one => one.status === 'running') ??
    run.lanes[0]!
  const waiting = run.lanes.filter(one => one.status === 'waiting').length
  const working = run.lanes.filter(one => one.status === 'running').length
  const queued = run.lanes.filter(one => one.status === 'queued').length

  if (!isBusy) {
    return (
      <>
        <CountTiles run={run} />
        <Columns
          main={
            <>
              <Result run={run} />
              <Section title="Each session">
                <Outcomes run={run} />
              </Section>
            </>
          }
          side={
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
                  <CardDescription>Every session, newest last. Each line names its session.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Activity events={run.events} />
                </CardContent>
              </Card>
              <Usage run={run} isBusy={false} />
            </>
          }
        />
      </>
    )
  }

  return (
    <>
      {run.progress && <ProgressBar {...run.progress} />}
      <CountTiles
        run={run}
        extra={
          <>
            <StatTile value={working} label="Working now" />
            {waiting > 0 && <StatTile value={waiting} label="Waiting for you" />}
            {queued > 0 && <StatTile value={queued} label="Up next" />}
          </>
        }
      />
      <section className="nx:flex nx:flex-col nx:gap-3">
        <div className="nx:flex nx:flex-col nx:gap-1">
          <h2 className="nx:typography-heading-small nx:m-0">Sessions</h2>
          <span className="nx:typography-body-small nx:text-muted-foreground">
            {run.atOnce} at a time, each in its own Chrome tab. Pick one to see its card and what it did.
          </span>
        </div>
        <div className="nx:grid nx:gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${run.lanes.length <= 3 ? 260 : 180}px, 1fr))` }}>
          {run.lanes.map(one => (
            <LaneTile key={one.key} lane={one} isPicked={one.key === lane.key} onPick={() => setPicked(one.key)} />
          ))}
        </div>
      </section>
      <LaneDetail lane={lane} />
      <Usage run={run} isBusy />
    </>
  )
}

/** The run going now, or the last one: its cards when it waits for you, its activity, and what it used. */
export function RunScreen(): JSX.Element {
  const status = useAppStatus()
  const run = status?.run

  if (!run) {
    return (
      <Page title="Running now">
        <EmptyState>
          <EmptyStateHeader>
            <EmptyStateTitle>Nothing is running</EmptyStateTitle>
            <EmptyStateDescription>Start a hunt, an application or the referral track from Home.</EmptyStateDescription>
          </EmptyStateHeader>
          <Button onClick={() => go('/')}>Go to Home</Button>
        </EmptyState>
      </Page>
    )
  }

  const isBusy = run.status === 'running' || run.status === 'waiting'
  const isMany = run.lanes.length > 1

  return (
    <Page
      meta={`Run ${run.id}${run.portal ? `, ${portalName(run.portal)}` : ''}, started ${time(run.started)}${isMany ? `, ${run.atOnce} at a time` : ''}`}
      title={run.title}
      badge={<RunStatusBadge status={run.status} />}
      description={run.subtitle ?? undefined}
      actions={
        <>
          {status?.browser.mode === 'controlled' && (
            <Button variant="outline" startIcon={<BrowserIcon />} onClick={() => void attempt(() => api.chrome.front())}>
              Bring Chrome forward
            </Button>
          )}
          {isBusy && (
            <Button variant="outline" startIcon={<StopIcon />} onClick={() => void attempt(() => api.runs.stop())}>
              {isMany ? 'Stop all' : 'Stop run'}
            </Button>
          )}
          {run.opportunityId && !isBusy && (
            <Button variant="outline" onClick={() => go(`/opportunity/${run.opportunityId}`)}>
              Open the row
            </Button>
          )}
          {run.flow === 'email' && (
            <Button variant={isBusy ? 'outline' : 'default'} onClick={() => go(`/email/${run.id}`)}>
              {isBusy ? 'Changes so far' : 'See what changed'}
            </Button>
          )}
        </>
      }
    >
      {isMany ? (
        <ManyLanes run={run} isBusy={isBusy} />
      ) : (
        <>
          {run.progress && isBusy && <ProgressBar {...run.progress} />}
          <CountTiles run={run} />
          <Columns
            main={
              <>
                <Result run={run} />
                {run.card ? (
                  <RunCardView card={run.card} />
                ) : isBusy ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Working in Chrome</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <span className="nx:typography-body-small nx:text-muted-foreground">
                        Claude is working in the Chrome window beside the app. Anything that needs you stops here on a card.
                      </span>
                    </CardContent>
                  </Card>
                ) : null}
              </>
            }
            side={
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Activity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Activity events={run.events} />
                  </CardContent>
                </Card>
                <Usage run={run} isBusy={isBusy} />
              </>
            }
          />
        </>
      )}
    </Page>
  )
}
