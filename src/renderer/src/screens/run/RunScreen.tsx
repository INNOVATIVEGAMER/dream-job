import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

import {
  BrowserIcon,
  CheckCircleIcon,
  ClockIcon,
  DotOutlineIcon,
  EnvelopeIcon,
  HandPalmIcon,
  MinusCircleIcon,
  PaperPlaneTiltIcon,
  StopIcon,
  TableIcon,
  UserPlusIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react'

import { SOURCE_NAMES, WORK_MODE_NAMES } from '../../../../shared/types'
import type { JobRow, LaneStatus, RunEvent, RunLane, RunState } from '../../../../shared/types'
import { api } from '../../lib/api'
import { useData } from '../../lib/data'
import { duration, portalName, tokens } from '../../lib/format'
import { go } from '../../lib/router'
import { useAppStatus } from '../../lib/status'
import { sendRequests } from '../../ui/CommandMenu'
import { attempt, Group, Hidden, Numbers, Page, RunStatusBadge, StatusBadge } from '../../ui/common'
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
  Progress,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/nx'
import { RunCardView } from './Cards'

const isActive = (status: LaneStatus | RunState['status']): boolean => status === 'running' || status === 'waiting'

const usageLine = (run: RunState): string =>
  [run.usage.ms ? duration(run.usage.ms) : '', run.lanes.length > 1 ? `${run.lanes.length} sessions` : '', `${run.usage.turns} turns`, run.usage.inputTokens ? `${tokens(run.usage.inputTokens)} tokens` : '']
    .filter(Boolean)
    .join(' · ')

const STEP: Record<RunEvent['kind'], ReactNode> = {
  good: <CheckCircleIcon size={14} className="nx:text-success-subtle-foreground" />,
  warn: <WarningIcon size={14} className="nx:text-warning-subtle-foreground" />,
  error: <XCircleIcon size={14} className="nx:text-error-subtle-foreground" />,
  step: <DotOutlineIcon size={14} className="nx:text-muted-foreground" />,
  tool: <DotOutlineIcon size={14} className="nx:text-muted-foreground" />,
  claude: <DotOutlineIcon size={14} className="nx:text-muted-foreground" />,
}

/** What a session did, as a quiet list of steps; the newest spins while it works. */
function Steps({ events, busy, waiting }: { events: RunEvent[]; busy: boolean; waiting?: boolean }): JSX.Element {
  const meaningful = events.filter(event => event.kind !== 'claude')
  const shown = (meaningful.some(event => event.kind !== 'tool') ? meaningful.filter(event => event.kind !== 'tool') : meaningful).slice(-14)
  if (shown.length === 0) return <span className="nx:typography-body-small nx:text-muted-foreground">Starting.</span>
  return (
    <ol className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col">
      {shown.map((event, i) => {
        const isLast = i === shown.length - 1
        const icon = isLast && waiting ? <HandPalmIcon size={14} className="nx:text-warning-subtle-foreground" /> : isLast && busy ? <Spinner /> : STEP[event.kind]
        return (
          <li key={event.id} className="nx:flex nx:items-center nx:gap-2 nx:min-h-7">
            <span className="nx:inline-flex nx:shrink-0">{icon}</span>
            <span className="nx:typography-body-small nx:flex-1 nx:min-w-0">{event.text}</span>
            <span className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">{new Date(event.at).toTimeString().slice(0, 5)}</span>
          </li>
        )
      })}
    </ol>
  )
}

function RunBody({ main, side }: { main: ReactNode; side: ReactNode }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-1 nx:items-stretch nx:min-h-0">
      <div className="nx:flex-1 nx:min-w-0 nx:px-10 nx:py-8">
        <div className="nx:max-w-[720px] nx:flex nx:flex-col nx:gap-6">{main}</div>
      </div>
      <aside aria-label="This run" className="nx:w-[320px] nx:shrink-0 nx:box-border nx:px-5 nx:py-6 nx:border-l-default nx:border-border-default nx:flex nx:flex-col nx:gap-6">
        {side}
      </aside>
    </div>
  )
}

/** What a session is doing right now, while nothing needs you. */
function Now({ lane }: { lane: RunLane }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-col nx:gap-3">
      <div className="nx:flex nx:items-start nx:gap-3">
        <Spinner />
        <div className="nx:flex nx:flex-col nx:gap-1 nx:min-w-0">
          <span className="nx:typography-label-default">{lane.progress?.label ?? lane.last ?? 'Starting'}</span>
          {lane.progress && (
            <span className="nx:typography-body-small nx:text-muted-foreground">
              {lane.progress.done} of {lane.progress.total}
            </span>
          )}
        </div>
      </div>
      {lane.progress && <Progress aria-label={lane.progress.label} value={lane.progress.total ? Math.round((lane.progress.done / lane.progress.total) * 100) : 0} />}
    </div>
  )
}

/** The jobs a hunt added, best first, each opening its job page. */
function Added({ runId, live }: { runId: number; live: boolean }): JSX.Element | null {
  const jobs = useData(() => api.runs.jobs(runId), [runId], ['jobs'])
  const list = jobs.data ?? []
  if (!list.length) return live ? null : <span className="nx:typography-body-small nx:text-muted-foreground">Nothing new fit this time.</span>
  return (
    <Table aria-label="Added by this hunt" density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>Company and role</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Portal</TableHead>
          <TableHead className="nx:text-end">Score</TableHead>
          <TableHead>
            <Hidden>Status</Hidden>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((job: JobRow) => (
          <TableRow key={job.id}>
            <TableCell>
              <button type="button" className="nx:flex nx:gap-2 nx:min-w-0 nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:text-left" onClick={() => go(`/job/${job.id}`)}>
                <span className="nx:typography-label-default nx:text-foreground nx:whitespace-nowrap">{job.company}</span>
                <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{job.role}</span>
              </button>
            </TableCell>
            <TableCell>
              <Badge variant="secondary" fill={job.workMode === 'not-stated' ? 'outline' : 'light'} isCaps={false}>
                {WORK_MODE_NAMES[job.workMode]}
              </Badge>
            </TableCell>
            <TableCell className="nx:typography-body-small">{SOURCE_NAMES[job.portal] ?? job.portal}</TableCell>
            <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{job.score ?? ''}</TableCell>
            <TableCell className="nx:text-end">
              <StatusBadge status={job.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Sends connection requests at the company of the job a run was about. */
async function requestsForJob(jobId: number): Promise<void> {
  const detail = await attempt(() => api.tracker.get(jobId))
  if (detail) await sendRequests([detail.job.companyId])
}

/** What comes next once a run has ended, by flow. */
function NextSteps({ run }: { run: RunState }): JSX.Element | null {
  const found = useData(() => (run.flow === 'hunt' ? api.runs.jobs(run.id) : Promise.resolve([] as JobRow[])), [run.id, run.flow], ['jobs'])
  const foundIds = (found.data ?? []).filter(job => job.status === 'found').map(job => job.id)
  switch (run.flow) {
    case 'apply':
      return (
        <>
          <Button startIcon={<PaperPlaneTiltIcon />} onClick={() => go('/tracker/found')}>
            Pick more to apply to
          </Button>
          {run.jobId && (
            <Button variant="outline" onClick={() => go(`/job/${run.jobId}`)}>
              Open job
            </Button>
          )}
          {run.jobId && (
            <Button variant="ghost" startIcon={<UserPlusIcon />} onClick={() => void requestsForJob(run.jobId!)}>
              Send connection requests
            </Button>
          )}
        </>
      )
    case 'hunt':
      return foundIds.length ? (
        <Button startIcon={<PaperPlaneTiltIcon />} onClick={() => void attempt(() => api.flows.apply(foundIds)).then(id => id && go('/run'))}>
          Apply to {foundIds.length} found
        </Button>
      ) : null
    case 'check':
      return (
        <Button startIcon={<PaperPlaneTiltIcon />} onClick={() => go('/tracker/found')}>
          Pick jobs to apply to
        </Button>
      )
    case 'email':
      return (
        <Button startIcon={<EnvelopeIcon />} onClick={() => go(`/email/${run.id}`)}>
          See what changed
        </Button>
      )
    case 'referral':
      return run.jobId ? (
        <Button variant="outline" onClick={() => go(`/job/${run.jobId}`)}>
          Open job
        </Button>
      ) : (
        <Button variant="outline" startIcon={<TableIcon />} onClick={() => go('/tracker/outreached')}>
          Open outreached jobs
        </Button>
      )
    case 'connect':
      return (
        <Button variant="outline" startIcon={<TableIcon />} onClick={() => go('/tracker/applied')}>
          Open applied jobs
        </Button>
      )
    default:
      return null
  }
}

function Outcome({ run }: { run: RunState }): JSX.Element {
  const tone = run.status === 'done' ? 'nx:text-success-subtle-foreground' : run.status === 'failed' ? 'nx:text-error-subtle-foreground' : 'nx:text-muted-foreground'
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="nx:inline-flex nx:items-center nx:gap-2">
            <span className={tone}>{run.status === 'done' ? <CheckCircleIcon /> : run.status === 'failed' ? <XCircleIcon /> : <MinusCircleIcon />}</span>
            {run.status === 'done' ? 'Done' : run.status === 'failed' ? 'It stopped on an error' : 'Stopped'}
          </span>
        </CardTitle>
        {run.result && <CardDescription>{run.result}</CardDescription>}
      </CardHeader>
      <CardFooter>
        <div className="nx:flex nx:flex-wrap nx:gap-2">
          <NextSteps run={run} />
        </div>
      </CardFooter>
    </Card>
  )
}

const showTab = (key: string): Promise<void | undefined> => attempt(() => api.runs.showTab(key))

/** A run of one session: its card or what it is doing, its steps beside it. */
function OneSession({ run }: { run: RunState }): JSX.Element {
  const lane = run.lanes[0]!
  const busy = isActive(run.status)
  return (
    <RunBody
      main={
        <>
          {run.card ? <RunCardView card={run.card} /> : busy ? <Now lane={lane} /> : <Outcome run={run} />}
          {run.flow === 'hunt' && (
            <Group title={busy ? 'Added so far' : 'Added'}>
              <Added runId={run.id} live={busy} />
            </Group>
          )}
        </>
      }
      side={
        <>
          {run.subtitle && (
            <Group title={run.flow === 'apply' ? 'Job' : 'This run'}>
              {run.jobId ? (
                <button type="button" className="nx:flex nx:flex-col nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:text-left" onClick={() => go(`/job/${run.jobId}`)}>
                  <span className="nx:typography-label-default nx:text-foreground">{run.subtitle}</span>
                  <span className="nx:typography-body-small nx:text-muted-foreground">{lane.title}</span>
                </button>
              ) : (
                <span className="nx:typography-body-small">{run.subtitle}</span>
              )}
            </Group>
          )}
          <Group title="Steps">
            <Steps events={lane.events.length ? lane.events : run.events} busy={busy} waiting={run.status === 'waiting'} />
          </Group>
          <span className="nx:typography-body-small nx:text-muted-foreground nx:mt-auto">{usageLine(run)}</span>
        </>
      }
    />
  )
}

const LANE_MARK: Record<LaneStatus, ReactNode> = {
  running: <Spinner />,
  waiting: <HandPalmIcon size={14} className="nx:text-warning-subtle-foreground" />,
  done: <CheckCircleIcon size={14} className="nx:text-success-subtle-foreground" />,
  failed: <XCircleIcon size={14} className="nx:text-error-subtle-foreground" />,
  stopped: <MinusCircleIcon size={14} className="nx:text-muted-foreground" />,
  queued: <ClockIcon size={14} className="nx:text-muted-foreground" />,
}

const GROUPS: { title: string; has: (lane: RunLane) => boolean }[] = [
  { title: 'Needs you', has: lane => lane.status === 'waiting' },
  { title: 'Working', has: lane => lane.status === 'running' },
  { title: 'Up next', has: lane => lane.status === 'queued' },
  { title: 'Done', has: lane => !isActive(lane.status) && lane.status !== 'queued' },
]

function laneLine(lane: RunLane): string {
  if (lane.status === 'queued') return 'Starts when a session frees up'
  if (lane.status === 'waiting') return lane.card?.kind === 'approve' ? 'Approve your answers' : 'Needs you'
  if (isActive(lane.status)) return lane.progress ? `${lane.progress.label}, ${lane.progress.done} of ${lane.progress.total}` : (lane.last ?? 'Starting')
  return lane.result ?? lane.last ?? ''
}

/** A run of several sessions: every session on the left, grouped; the picked one on the right. */
function ManySessions({ run }: { run: RunState }): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)
  const busy = isActive(run.status)
  const lane =
    run.lanes.find(one => one.key === picked) ?? run.lanes.find(one => one.status === 'waiting') ?? run.lanes.find(one => one.status === 'running') ?? run.lanes[0]!
  const done = run.lanes.filter(one => !isActive(one.status) && one.status !== 'queued').length

  if (!busy) {
    return (
      <div className="nx:px-8 nx:py-6 nx:flex nx:flex-col nx:gap-5 nx:max-w-[1040px]">
        <Outcome run={run} />
        {run.flow === 'hunt' && (
          <Group title="Added">
            <Added runId={run.id} live={false} />
          </Group>
        )}
        <Group title="Each session">
          <Table aria-label="How each session went" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>How it went</TableHead>
                <TableHead>Took</TableHead>
                <TableHead>
                  <Hidden>Open</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.lanes.map(one => (
                <TableRow key={one.key}>
                  <TableCell>
                    <div className="nx:flex nx:items-center nx:gap-2 nx:min-w-0">
                      {LANE_MARK[one.status]}
                      <span className="nx:typography-label-default nx:whitespace-nowrap">{one.title}</span>
                      {one.subtitle && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{one.subtitle}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="nx:typography-body-small">{one.result}</TableCell>
                  <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">
                    {one.started && one.ended ? duration(new Date(one.ended).getTime() - new Date(one.started).getTime()) : ''}
                  </TableCell>
                  <TableCell className="nx:text-end">
                    {one.jobId && (
                      <Button variant="ghost" size="sm" onClick={() => go(`/job/${one.jobId}`)}>
                        Open job
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Group>
        <span className="nx:typography-body-small nx:text-muted-foreground">{usageLine(run)}</span>
      </div>
    )
  }

  return (
    <div className="nx:flex nx:flex-1 nx:items-stretch nx:min-h-0">
      <nav aria-label="Sessions" className="nx:w-[320px] nx:shrink-0 nx:box-border nx:border-r-default nx:border-border-default nx:px-2 nx:py-3 nx:flex nx:flex-col">
        <div className="nx:flex nx:flex-col nx:gap-2 nx:px-3 nx:pb-2">
          <div className="nx:flex nx:justify-between nx:typography-body-small">
            <span>
              {done} of {run.lanes.length} done
            </span>
            <span className="nx:text-muted-foreground">{run.atOnce} at a time</span>
          </div>
          <Progress aria-label="Sessions done" value={Math.round((done / run.lanes.length) * 100)} />
        </div>
        {GROUPS.map(group => {
          const lanes = run.lanes.filter(group.has)
          if (!lanes.length) return null
          return (
            <div key={group.title} className="nx:flex nx:flex-col">
              <span className="nx:typography-label-caps nx:text-muted-foreground nx:px-3 nx:pt-3 nx:pb-1">
                {group.title} {lanes.length}
              </span>
              {lanes.map(one => (
                <button
                  key={one.key}
                  type="button"
                  aria-pressed={one.key === lane.key}
                  onClick={() => setPicked(one.key)}
                  className={`nx:flex nx:items-start nx:gap-2 nx:px-3 nx:py-2 nx:rounded-md nx:border-0 nx:text-left nx:cursor-pointer nx:text-foreground ${one.key === lane.key ? 'nx:bg-muted' : 'nx:bg-transparent nx:hover:bg-container-hover'}`}
                >
                  <span className="nx:inline-flex nx:pt-0.5">{LANE_MARK[one.status]}</span>
                  <span className="nx:flex nx:flex-col nx:min-w-0 nx:flex-1">
                    <span className="nx:flex nx:gap-2 nx:min-w-0">
                      <span className="nx:typography-label-default nx:whitespace-nowrap">{one.title}</span>
                      {one.subtitle && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{one.subtitle}</span>}
                    </span>
                    <span className="nx:typography-body-small nx:text-muted-foreground nx:line-clamp-2">{laneLine(one)}</span>
                  </span>
                </button>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="nx:flex-1 nx:min-w-0 nx:px-8 nx:py-6">
        <div className="nx:max-w-[720px] nx:flex nx:flex-col nx:gap-5">
          <div className="nx:flex nx:items-start nx:justify-between nx:gap-2">
            <div className="nx:flex nx:flex-col nx:min-w-0">
              {lane.jobId ? (
                <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:text-left nx:typography-label-default nx:text-foreground" onClick={() => go(`/job/${lane.jobId}`)}>
                  {lane.subtitle ?? lane.title}
                </button>
              ) : (
                <span className="nx:typography-label-default">{lane.title}</span>
              )}
              <Numbers items={[lane.jobId ? lane.title : lane.subtitle, lane.portal ? portalName(lane.portal) || lane.portal : null].filter(Boolean) as string[]} />
            </div>
            {isActive(lane.status) && (
              <Button variant="ghost" size="sm" startIcon={<BrowserIcon />} onClick={() => void showTab(lane.key)}>
                Show tab
              </Button>
            )}
          </div>
          {lane.card ? (
            <RunCardView card={lane.card} />
          ) : isActive(lane.status) ? (
            <Now lane={lane} />
          ) : (
            <span className="nx:typography-body-default">{lane.status === 'queued' ? 'Starts when a session frees up.' : lane.result}</span>
          )}
          {run.flow === 'hunt' && (
            <Group title="Added so far">
              <Added runId={run.id} live />
            </Group>
          )}
          <Group title="Steps">
            <Steps events={lane.events} busy={isActive(lane.status)} waiting={lane.status === 'waiting'} />
          </Group>
        </div>
      </div>
    </div>
  )
}

/** The run going now, or the last one. */
export function RunScreen(): JSX.Element {
  const status = useAppStatus()
  const run = status?.run

  if (!run) {
    return (
      <Page title="Running now">
        <EmptyState>
          <EmptyStateHeader>
            <EmptyStateTitle>Nothing is running</EmptyStateTitle>
            <EmptyStateDescription>Start a hunt, an application or the referral track.</EmptyStateDescription>
          </EmptyStateHeader>
          <Button onClick={() => go('/')}>Go to Home</Button>
        </EmptyState>
      </Page>
    )
  }

  const busy = isActive(run.status)
  const isMany = run.lanes.length > 1
  return (
    <Page
      title={run.title}
      badge={<RunStatusBadge status={run.status} />}
      meta={`Run ${run.id}${isMany ? ` · ${run.atOnce} at a time` : ''}`}
      layout="bare"
      actions={
        busy ? (
          <>
            {!isMany && status?.browser.mode === 'controlled' && (
              <Button variant="ghost" size="sm" startIcon={<BrowserIcon />} onClick={() => void attempt(() => api.chrome.front())}>
                Show tab
              </Button>
            )}
            <Button variant="outline" size="sm" startIcon={<StopIcon />} onClick={() => void attempt(() => api.runs.stop())}>
              {isMany ? 'Stop all' : 'Stop'}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" startIcon={<TableIcon />} onClick={() => go('/tracker')}>
            Open tracker
          </Button>
        )
      }
    >
      {isMany ? <ManySessions run={run} /> : <OneSession run={run} />}
    </Page>
  )
}
