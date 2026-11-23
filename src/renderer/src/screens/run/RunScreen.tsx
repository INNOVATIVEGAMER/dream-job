import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

import {
  ArrowCounterClockwiseIcon,
  BrowserIcon,
  CheckCircleIcon,
  ClockIcon,
  DotOutlineIcon,
  EnvelopeIcon,
  HandPalmIcon,
  MinusCircleIcon,
  PaperPlaneTiltIcon,
  SquaresFourIcon,
  StopIcon,
  TrashIcon,
  TableIcon,
  UserPlusIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react'

import { DISCARD_REASON_NAMES, SOURCE_NAMES, WORK_MODE_NAMES } from '../../../../shared/types'
import type { JobRow, LaneStatus, RunEvent, RunLane, RunState } from '../../../../shared/types'
import { api } from '../../lib/api'
import { useData } from '../../lib/data'
import { duration, portalName, tokens } from '../../lib/format'
import { go } from '../../lib/router'
import { useAppStatus } from '../../lib/status'
import { sendRequests } from '../../ui/CommandMenu'
import { attempt, Group, Hidden, Numbers, Page, RunStatusBadge, StatusBadge } from '../../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
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

/** What a session did, as a quiet list of steps; the newest spins while it works. While it works, only the latest; once it ends, all of them. */
function Steps({ events, busy, waiting }: { events: RunEvent[]; busy: boolean; waiting?: boolean }): JSX.Element {
  const meaningful = events.filter(event => event.kind !== 'claude')
  const said = meaningful.some(event => event.kind !== 'tool') ? meaningful.filter(event => event.kind !== 'tool') : meaningful
  const shown = busy || waiting ? said.slice(-14) : said
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

function RunBody({ main, side, wide }: { main: ReactNode; side: ReactNode; wide?: boolean }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-1 nx:items-stretch nx:min-h-0">
      <div className="nx:flex-1 nx:min-w-0 nx:px-10 nx:py-8">
        <div className={`${wide ? 'nx:max-w-[960px]' : 'nx:max-w-[720px]'} nx:flex nx:flex-col nx:gap-6`}>{main}</div>
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

type HuntJobs = { added: JobRow[]; discarded: JobRow[] }

/** What a hunt added and what it ruled out, kept current as it goes. Empty for any other run. */
function useHuntJobs(runId: number, isHunt: boolean): HuntJobs {
  const none = (): Promise<JobRow[]> => Promise.resolve([])
  const added = useData(() => (isHunt ? api.runs.jobs(runId) : none()), [runId, isHunt], ['jobs'])
  const discarded = useData(() => (isHunt ? api.runs.discarded(runId) : none()), [runId, isHunt], ['jobs'])
  return { added: added.data ?? [], discarded: discarded.data ?? [] }
}

/** A job's company, opening the company, and its role, opening the job. */
function CompanyAndRole({ job }: { job: JobRow }): JSX.Element {
  return (
    <div className="nx:flex nx:items-center nx:gap-2 nx:min-w-0 nx:max-w-[360px]">
      <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground nx:whitespace-nowrap" onClick={() => go(`/company/${job.companyId}`)}>
        {job.company}
      </button>
      <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-body-small nx:text-muted-foreground nx:truncate nx:text-left" onClick={() => go(`/job/${job.id}`)}>
        {job.role}
      </button>
    </div>
  )
}

const quiet = (text: string): JSX.Element => <span className="nx:typography-body-small nx:text-muted-foreground">{text}</span>

/** The jobs a hunt added, best first. */
function AddedTable({ jobs, live, withPortal }: { jobs: JobRow[]; live: boolean; withPortal: boolean }): JSX.Element {
  if (!jobs.length) return quiet(live ? 'Nothing added yet.' : 'Nothing new fit this time.')
  return (
    <Table aria-label="Added by this hunt" density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>Company and role</TableHead>
          <TableHead>Mode</TableHead>
          {withPortal && <TableHead>Portal</TableHead>}
          <TableHead className="nx:text-end">Score</TableHead>
          <TableHead>
            <Hidden>Status</Hidden>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map(job => (
          <TableRow key={job.id}>
            <TableCell>
              <CompanyAndRole job={job} />
            </TableCell>
            <TableCell>
              <Badge variant="secondary" fill={job.workMode === 'not-stated' ? 'outline' : 'light'} isCaps={false}>
                {WORK_MODE_NAMES[job.workMode]}
              </Badge>
            </TableCell>
            {withPortal && <TableCell className="nx:typography-body-small">{SOURCE_NAMES[job.portal] ?? job.portal}</TableCell>}
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

/** The jobs a hunt ruled out: the posting's own words that did it, the reason, and a way back to Found. */
function DiscardedTable({ jobs, live, withPortal }: { jobs: JobRow[]; live: boolean; withPortal: boolean }): JSX.Element {
  if (!jobs.length) return quiet(live ? 'Nothing ruled out yet.' : 'Nothing was ruled out.')
  return (
    <Table aria-label="Discarded by this hunt" density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>Company and role</TableHead>
          <TableHead>The line that ruled it out</TableHead>
          <TableHead>Reason</TableHead>
          {withPortal && <TableHead>Portal</TableHead>}
          <TableHead>
            <Hidden>Restore</Hidden>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map(job => (
          <TableRow key={job.id}>
            <TableCell>
              <CompanyAndRole job={job} />
            </TableCell>
            <TableCell>{job.discardLine ? <q className="nx:typography-body-small nx:text-muted-foreground nx:line-clamp-2">{job.discardLine}</q> : quiet('–')}</TableCell>
            <TableCell>
              {job.discardReason && (
                <Badge variant="secondary" fill="light" isCaps={false}>
                  {DISCARD_REASON_NAMES[job.discardReason]}
                </Badge>
              )}
            </TableCell>
            {withPortal && <TableCell className="nx:typography-body-small">{SOURCE_NAMES[job.portal] ?? job.portal}</TableCell>}
            <TableCell className="nx:text-end">
              {job.status === 'discarded' ? (
                <Button variant="outline" size="sm" startIcon={<ArrowCounterClockwiseIcon />} onClick={() => void attempt(() => api.tracker.restore(job.id), 'Back in Found')}>
                  Restore
                </Button>
              ) : (
                <StatusBadge status={job.status} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** A hunt's added and discarded jobs: every portal's, or one portal's. */
function HuntTables({ jobs, portal, live }: { jobs: HuntJobs; portal: string | null; live: boolean }): JSX.Element {
  const mine = (job: JobRow): boolean => !portal || job.portal === portal
  const added = jobs.added.filter(mine)
  const discarded = jobs.discarded.filter(mine)
  return (
    <>
      <Group title={`${live ? 'Added so far' : 'Added'} ${added.length}`}>
        <AddedTable jobs={added} live={live} withPortal={!portal} />
      </Group>
      <Group title={`Discarded ${discarded.length}`}>
        <DiscardedTable jobs={discarded} live={live} withPortal={!portal} />
      </Group>
    </>
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

const ENDED: Record<'done' | 'failed' | 'stopped', { title: Record<'hunt' | 'other', string>; variant: 'success' | 'destructive' | 'default'; icon: JSX.Element }> = {
  done: { title: { hunt: 'Hunt done', other: 'Done' }, variant: 'success', icon: <CheckCircleIcon /> },
  failed: { title: { hunt: 'The hunt stopped on an error', other: 'It stopped on an error' }, variant: 'destructive', icon: <XCircleIcon /> },
  stopped: { title: { hunt: 'Hunt stopped', other: 'Stopped' }, variant: 'default', icon: <MinusCircleIcon /> },
}

/** Across the top once a run has ended, live or in history: how it came out, and what to do next. */
function EndedBanner({ run, presentation = 'banner' }: { run: RunState; presentation?: 'banner' | 'card' }): JSX.Element {
  const ended = ENDED[run.status === 'done' || run.status === 'failed' ? run.status : 'stopped']
  return (
    <Alert variant={ended.variant} presentation={presentation} layout="inline" role="status">
      <AlertIcon>{ended.icon}</AlertIcon>
      <AlertContent>
        <AlertTitle>{ended.title[run.flow === 'hunt' ? 'hunt' : 'other']}</AlertTitle>
        {run.result && <AlertDescription>{run.result}</AlertDescription>}
      </AlertContent>
      <div className="nx:flex nx:flex-wrap nx:gap-2">
        <NextSteps run={run} />
      </div>
    </Alert>
  )
}

const showTab = (key: string): Promise<void | undefined> => attempt(() => api.runs.showTab(key))

/**
 * For one application in a run: discards its job and leaves its session,
 * while the rest carry on. There while it waits its turn, works or waits on
 * you. An application already sent stays applied.
 */
function DiscardAndLeave({ run, lane }: { run: RunState; lane: RunLane }): JSX.Element | null {
  const [isLeaving, setIsLeaving] = useState(false)
  if (run.flow !== 'apply' || !lane.jobId || !(isActive(lane.status) || lane.status === 'queued')) return null
  const leave = async (): Promise<void> => {
    setIsLeaving(true)
    await attempt(() => api.runs.leave(lane.key), `Discarding ${lane.title}`)
    setIsLeaving(false)
  }
  return (
    <Button variant="outline" size="sm" startIcon={<TrashIcon />} disabled={isLeaving} onClick={() => void leave()}>
      {isLeaving ? 'Leaving...' : 'Discard and leave'}
    </Button>
  )
}

/** A run of one session: its card or what it is doing, its steps beside it. */
function OneSession({ run }: { run: RunState }): JSX.Element {
  const lane = run.lanes[0]!
  const busy = isActive(run.status)
  const isHunt = run.flow === 'hunt'
  const jobs = useHuntJobs(run.id, isHunt)
  return (
    <RunBody
      wide={isHunt}
      main={
        <>
          {run.card ? <RunCardView card={run.card} /> : busy ? <Now lane={lane} /> : <EndedBanner run={run} presentation="card" />}
          {isHunt && <HuntTables jobs={jobs} portal={lane.portal} live={busy} />}
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

/** The key of a hunt's Overall entry: every portal's jobs together. */
const OVERALL = 'overall'

const navItem = (isPicked: boolean): string =>
  `nx:flex nx:items-start nx:gap-2 nx:px-3 nx:py-2 nx:rounded-md nx:border-0 nx:text-left nx:cursor-pointer nx:text-foreground ${isPicked ? 'nx:bg-muted' : 'nx:bg-transparent nx:hover:bg-container-hover'}`

/**
 * A run of several sessions: every session on the left, grouped; the picked
 * one on the right. A hunt also has Overall at the top, every portal's jobs
 * together. The layout stays the same once the run ends and in run history,
 * so every session stays a click away.
 */
function ManySessions({ run }: { run: RunState }): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)
  const busy = isActive(run.status)
  const isHunt = run.flow === 'hunt'
  const jobs = useHuntJobs(run.id, isHunt)

  const waiting = run.lanes.find(one => one.status === 'waiting')
  const lane = run.lanes.find(one => one.key === picked) ?? waiting ?? run.lanes.find(one => one.status === 'running') ?? run.lanes[0]!
  // A hunt opens on Overall, unless a session needs the user.
  const overall = isHunt && (picked === OVERALL || (picked === null && !waiting))
  const done = run.lanes.filter(one => !isActive(one.status) && one.status !== 'queued').length

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
        {isHunt && (
          <button type="button" aria-pressed={overall} onClick={() => setPicked(OVERALL)} className={`${navItem(overall)} nx:mt-2`}>
            <span className="nx:inline-flex nx:pt-0.5">
              <SquaresFourIcon size={14} className="nx:text-muted-foreground" />
            </span>
            <span className="nx:flex nx:flex-col nx:min-w-0 nx:flex-1">
              <span className="nx:typography-label-default">Overall</span>
              <span className="nx:typography-body-small nx:text-muted-foreground">
                Added {jobs.added.length}, discarded {jobs.discarded.length}
              </span>
            </span>
          </button>
        )}
        {GROUPS.map(group => {
          const lanes = run.lanes.filter(group.has)
          if (!lanes.length) return null
          return (
            <div key={group.title} className="nx:flex nx:flex-col">
              <span className="nx:typography-label-caps nx:text-muted-foreground nx:px-3 nx:pt-3 nx:pb-1">
                {group.title} {lanes.length}
              </span>
              {lanes.map(one => {
                const isPicked = !overall && one.key === lane.key
                return (
                  <button key={one.key} type="button" aria-pressed={isPicked} onClick={() => setPicked(one.key)} className={navItem(isPicked)}>
                    <span className="nx:inline-flex nx:pt-0.5">{LANE_MARK[one.status]}</span>
                    <span className="nx:flex nx:flex-col nx:min-w-0 nx:flex-1">
                      <span className="nx:flex nx:gap-2 nx:min-w-0">
                        <span className="nx:typography-label-default nx:whitespace-nowrap">{one.title}</span>
                        {one.subtitle && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{one.subtitle}</span>}
                      </span>
                      <span className="nx:typography-body-small nx:text-muted-foreground nx:line-clamp-2">{laneLine(one)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
        {!busy && <span className="nx:typography-body-small nx:text-muted-foreground nx:mt-auto nx:px-3 nx:pt-4">{usageLine(run)}</span>}
      </nav>
      <div className="nx:flex-1 nx:min-w-0 nx:px-8 nx:py-6">
        <div className={`${isHunt ? 'nx:max-w-[960px]' : 'nx:max-w-[720px]'} nx:flex nx:flex-col nx:gap-5`}>
          {overall ? (
            <>
              <div className="nx:flex nx:flex-col nx:min-w-0">
                <span className="nx:typography-label-default">Overall</span>
                <Numbers items={[run.subtitle ?? '', 'Every portal'].filter(Boolean)} />
              </div>
              <HuntTables jobs={jobs} portal={null} live={busy} />
            </>
          ) : (
            <>
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
                <div className="nx:flex nx:items-center nx:gap-2 nx:shrink-0">
                  {isActive(lane.status) && (
                    <Button variant="ghost" size="sm" startIcon={<BrowserIcon />} onClick={() => void showTab(lane.key)}>
                      Show tab
                    </Button>
                  )}
                  <DiscardAndLeave key={lane.key} run={run} lane={lane} />
                </div>
              </div>
              {lane.card ? (
                <RunCardView card={lane.card} />
              ) : isActive(lane.status) ? (
                <Now lane={lane} />
              ) : (
                <span className="nx:typography-body-default">{lane.status === 'queued' ? 'Starts when a session frees up.' : lane.result}</span>
              )}
              {isHunt && <HuntTables jobs={jobs} portal={lane.portal} live={isActive(lane.status)} />}
              <Group title="Steps">
                <Steps events={lane.events} busy={isActive(lane.status)} waiting={lane.status === 'waiting'} />
              </Group>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A run as it runs, once it ends and in run history: the same layout throughout, with a banner across the top once a run of several sessions ends. */
export function RunView({ run }: { run: RunState }): JSX.Element {
  if (run.lanes.length <= 1) return <OneSession run={run} />
  return (
    <div className="nx:flex nx:flex-col nx:flex-1 nx:min-h-0">
      {!isActive(run.status) && <EndedBanner run={run} />}
      <ManySessions run={run} />
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
            {!isMany && run.lanes[0] && <DiscardAndLeave run={run} lane={run.lanes[0]} />}
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
      <RunView run={run} />
    </Page>
  )
}
