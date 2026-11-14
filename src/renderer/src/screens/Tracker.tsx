import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CircleDashedIcon,
  DotsThreeIcon,
  EnvelopeIcon,
  FunnelIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  UserPlusIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react'

import {
  AT_ONCE,
  CHECK_STATUSES,
  DISCARD_REASON_NAMES,
  DISCARD_REASONS,
  REQUESTS_PER_COMPANY,
  SOURCE_NAMES,
  SOURCES,
  STAGES,
  STATUS_NAMES,
  STATUSES,
  TRACKER_VIEW_NAMES,
  TRACKER_VIEWS,
  WORK_MODE_NAMES,
  WORK_MODES,
} from '../../../shared/types'
import type { CompanyList, CompanyQuery, CompanyRow, DiscardReason, JobRow, Preferences, Status, TrackerView, WorkMode } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { capitalize, day, plural } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { checkPostings, sendRequests } from '../ui/CommandMenu'
import { attempt, ErrorNote, Hidden, Loading, Page, StatusBadge } from '../ui/common'
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
  FilterChip,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectionCell,
  TableSelectionHead,
  Tabs,
  TabsList,
  TabsTrigger,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from '../ui/nx'
import { AddJobDialog } from './AddJob'

const HOVER = 'nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity'

/** Statuses the picked jobs can be set to; discarding has its own button, on Found. */
const SET_STATUSES = STATUSES.filter(status => status !== 'discarded')

/** The modes the tracker opens on: the ones the user prefers, and jobs that don't say. Every mode when all are preferred. */
function preferredModes(prefs: Preferences): WorkMode[] {
  const wanted = WORK_MODES.filter(mode => mode !== 'not-stated' && prefs.modes[mode])
  return wanted.length === 0 || wanted.length === 3 ? [] : [...wanted, 'not-stated']
}

const modeList = (modes: WorkMode[]): string => modes.map(mode => WORK_MODE_NAMES[mode]).join(', ')

const sourceName = (job: JobRow): string => SOURCE_NAMES[job.portal] ?? job.portal

const yearsText = (years: number | null | undefined): string => (typeof years === 'number' ? `${years}+ yrs` : '')

/** A company's minimum years: shown only when every job in the view asks the same. */
function sameYears(jobs: JobRow[]): number | null {
  const first = jobs[0]?.minYears
  return typeof first === 'number' && jobs.every(job => job.minYears === first) ? first : null
}

/** The tab's number: companies in each view, but jobs in Discarded, which lists jobs. */
const countOf = (data: CompanyList | undefined, view: TrackerView): number | string => (data ? (view === 'discarded' ? data.discardedJobs : data.counts[view]) : '')

function ModeBadge({ mode }: { mode: WorkMode }): JSX.Element {
  return (
    <Badge variant="secondary" fill={mode === 'not-stated' ? 'outline' : 'light'} isCaps={false}>
      {WORK_MODE_NAMES[mode]}
    </Badge>
  )
}

/** A company's work modes, from its jobs in the view, in the usual order. */
function Modes({ jobs }: { jobs: JobRow[] }): JSX.Element {
  const modes = WORK_MODES.filter(mode => jobs.some(job => job.workMode === mode))
  return (
    <div className="nx:flex nx:flex-wrap nx:gap-1">
      {modes.map(mode => (
        <ModeBadge key={mode} mode={mode} />
      ))}
    </div>
  )
}

/** Who the user knows at a company: connections first, then requests still out. */
function People({ row }: { row: CompanyRow }): JSX.Element {
  const { connected, requested } = row.people
  if (!connected && !requested) return <span className="nx:text-muted-foreground">–</span>
  return (
    <span className="nx:whitespace-nowrap">
      {connected > 0 && <span>{connected} connected</span>}
      {connected > 0 && requested > 0 && <span className="nx:text-muted-foreground"> · </span>}
      {requested > 0 && <span className="nx:text-muted-foreground">{requested} sent</span>}
    </span>
  )
}

function JobMenu({ job }: { job: JobRow }): JSX.Element {
  const opens = job.link ?? job.portalLink
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${job.role}`}>
          <DotsThreeIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => go(`/job/${job.id}`)}>Open job</DropdownMenuItem>
        {opens && (
          <DropdownMenuItem onSelect={() => void attempt(() => api.chrome.openUrl(opens))}>
            <ArrowSquareOutIcon /> Open posting
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={job.status} onValueChange={status => void attempt(() => api.tracker.setStatus(job.id, status), 'Status saved')}>
          {STATUSES.map(status => (
            <DropdownMenuRadioItem key={status} value={status}>
              {STATUS_NAMES[status]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CompanyMenu({ row }: { row: CompanyRow }): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${row.name}`}>
          <DotsThreeIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => go(`/company/${row.id}`)}>Open company</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void attempt(() => api.companies.setNeverShow(row.id, !row.neverShow), row.neverShow ? 'Shown in hunts again' : 'Hunts will skip it')}>
          {row.neverShow ? 'Show in hunts again' : 'Never show in hunts'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Jobs a hunt ruled out, newest first: the posting's own words that did it, and a way back to Found. */
function DiscardedTable({ jobs }: { jobs: JobRow[] }): JSX.Element {
  const rows = [...jobs].sort((a, b) => b.updated.localeCompare(a.updated))
  return (
    <Table aria-label="Discarded jobs" density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>Company and role</TableHead>
          <TableHead>The line that ruled it out</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Discarded</TableHead>
          <TableHead>
            <Hidden>Restore</Hidden>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(job => (
          <TableRow key={job.id} className="nx:group">
            <TableCell>
              <div className="nx:flex nx:items-center nx:gap-2 nx:min-w-0 nx:max-w-[320px]">
                <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground nx:whitespace-nowrap" onClick={() => go(`/company/${job.companyId}`)}>
                  {job.company}
                </button>
                <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-body-small nx:text-muted-foreground nx:truncate nx:text-left" onClick={() => go(`/job/${job.id}`)}>
                  {job.role}
                </button>
              </div>
            </TableCell>
            <TableCell>{job.discardLine ? <q className="nx:typography-body-small nx:text-muted-foreground nx:line-clamp-2">{job.discardLine}</q> : <span className="nx:text-muted-foreground">–</span>}</TableCell>
            <TableCell>
              {job.discardReason && (
                <Badge variant="secondary" fill="light" isCaps={false}>
                  {DISCARD_REASON_NAMES[job.discardReason]}
                </Badge>
              )}
            </TableCell>
            <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">{day(job.updated)}</TableCell>
            <TableCell className="nx:text-end">
              <div className={HOVER}>
                <Button variant="outline" size="sm" startIcon={<ArrowCounterClockwiseIcon />} onClick={() => void attempt(() => api.tracker.restore(job.id), 'Back in Found')}>
                  Restore
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

type Filters = Omit<CompanyQuery, 'view' | 'modes'>

/** The tracker, company first: each company with its jobs as rows beneath it. Discarded lists jobs, with why. */
export function Tracker({ adding = false, view = 'all' }: { adding?: boolean; view?: TrackerView }): JSX.Element {
  const status = useAppStatus()
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const defaultModes = settings.data ? preferredModes(settings.data.preferences) : null
  const [filters, setFilters] = useState<Filters>({ stage: 'all', portal: 'all', search: '' })
  const [pickedModes, setPickedModes] = useState<WorkMode[] | null>(null)
  const [reason, setReason] = useState<DiscardReason | 'all'>('all')
  // Opens on the modes the user prefers, until they pick their own.
  const modes = pickedModes ?? defaultModes ?? []
  const shown: CompanyQuery = { ...filters, view, modes }
  const toggleMode = (mode: WorkMode, on: boolean): void => {
    const current = modes.length ? modes : [...WORK_MODES]
    const next = WORK_MODES.filter(one => (one === mode ? on : current.includes(one)))
    if (next.length === 0) return
    setPickedModes(next.length === WORK_MODES.length ? [] : next)
  }
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [closed, setClosed] = useState<Set<number>>(new Set())
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [isAdding, setAdding] = useState(adding)
  const list = useData(() => api.tracker.companies(shown), [JSON.stringify(shown)], ['jobs', 'people'])
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  useEffect(() => {
    const timer = setTimeout(() => setFilters(current => (current.search === search ? current : { ...current, search })), 200)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => setAdding(adding), [adding])
  // A pick belongs to the view it was made in.
  useEffect(() => setPicked(new Set()), [view])

  const data = list.data
  const companies = useMemo(() => data?.companies ?? [], [data])
  // Companies with several jobs in the view open by themselves; the caret overrides either way.
  const isOpen = (row: CompanyRow): boolean => open.has(row.id) || (row.jobs.length > 1 && !closed.has(row.id))
  const toggleOpen = (row: CompanyRow): void => {
    const was = isOpen(row)
    setOpen(current => {
      const next = new Set(current)
      if (was) next.delete(row.id)
      else next.add(row.id)
      return next
    })
    setClosed(current => {
      const next = new Set(current)
      if (was) next.add(row.id)
      else next.delete(row.id)
      return next
    })
  }

  const isDiscarded = view === 'discarded'
  const discarded = companies.flatMap(row => row.jobs).filter(job => reason === 'all' || job.discardReason === reason)
  const jobsById = useMemo(() => new Map(companies.flatMap(row => row.jobs.map(job => [job.id, job] as const))), [companies])
  const pickedJobs = [...picked].map(id => jobsById.get(id)).filter((job): job is JobRow => !!job)
  const pickedFound = pickedJobs.filter(job => job.status === 'found')
  const pickedCheckable = pickedJobs.filter(job => CHECK_STATUSES.includes(job.status))
  const pickedRows = companies.filter(row => row.jobs.some(job => picked.has(job.id)))
  // Requests and refreshes go to every picked company, before or after applying.
  const canConnect = view === 'found' || view === 'applied'
  const pick = (ids: number[], on: boolean): void =>
    setPicked(current => {
      const next = new Set(current)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  const allIds = companies.flatMap(row => row.jobs.map(job => job.id))
  const pickedHere = allIds.filter(id => picked.has(id)).length
  const clear = (): void => setPicked(new Set())

  const applyPicked = async (): Promise<void> => {
    if (await attempt(() => api.flows.apply(pickedFound.map(job => job.id)))) {
      clear()
      go('/run')
    }
  }
  const connectPicked = async (): Promise<void> => {
    if (await sendRequests(pickedRows.map(row => row.id))) clear()
  }
  // Refreshing stays on the tracker: the People column fills in as each company is read.
  const refreshPicked = async (): Promise<void> => {
    const n = pickedRows.length
    const runId = await attempt(() => api.flows.refreshPeople(pickedRows.map(row => row.id)), `Reading your LinkedIn connections at ${n === 1 ? pickedRows[0]!.name : `${n} companies`}`)
    if (runId) clear()
  }
  const setStatusOf = async (jobs: JobRow[], next: Status, done: string): Promise<void> => {
    await attempt(async () => {
      for (const job of jobs) await api.tracker.setStatus(job.id, next)
    }, done)
    clear()
  }

  const chips: { key: string; label: string; clear: () => void }[] = []
  if (filters.stage !== 'all') chips.push({ key: 'stage', label: `Stage: ${capitalize(filters.stage)}`, clear: () => setFilters(current => ({ ...current, stage: 'all' })) })
  if (filters.portal !== 'all') {
    const name = SOURCE_NAMES[filters.portal as keyof typeof SOURCE_NAMES] ?? filters.portal
    chips.push({ key: 'portal', label: `Portal: ${name}`, clear: () => setFilters(current => ({ ...current, portal: 'all' })) })
  }
  if (modes.length) chips.push({ key: 'mode', label: `Mode: ${modeList(modes)}`, clear: () => setPickedModes([]) })
  if (isDiscarded && reason !== 'all') chips.push({ key: 'reason', label: `Reason: ${DISCARD_REASON_NAMES[reason].toLowerCase()}`, clear: () => setReason('all') })
  const isFiltered = !!filters.search || chips.length > 0
  const isEmpty = isDiscarded ? discarded.length === 0 : companies.length === 0
  const viewName = TRACKER_VIEW_NAMES[view].toLowerCase()

  return (
    <Page
      title="Tracker"
      meta={data ? `${plural(data.totalCompanies, 'company', 'companies')} · ${plural(data.totalJobs, 'job')}` : undefined}
      layout="list"
      actions={
        <>
          <Button variant="ghost" size="sm" startIcon={<EnvelopeIcon />} onClick={() => go('/email')}>
            Update from Gmail
          </Button>
          <Button variant="outline" size="sm" startIcon={<PlusIcon />} onClick={() => setAdding(true)}>
            Add job
          </Button>
        </>
      }
    >
      <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-3 nx:px-4 nx:py-2 nx:border-b-default nx:border-border-default">
        <Tabs value={view} onValueChange={next => go(`/tracker/${next}`)}>
          <TabsList variant="underline" size="sm">
            {TRACKER_VIEWS.map(one => (
              <TabsTrigger key={one} value={one}>
                {TRACKER_VIEW_NAMES[one]}
                <span className="nx:ml-1 nx:text-muted-foreground">{countOf(data, one)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="nx:flex nx:items-center nx:gap-2">
          <div className="nx:w-60">
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <MagnifyingGlassIcon />
              </InputGroupAddon>
              <InputGroupInput type="search" aria-label="Search companies and roles" placeholder="Search companies and roles" value={search} onChange={event => setSearch(event.target.value)} />
            </InputGroup>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" startIcon={<FunnelIcon />}>
                Filter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isDiscarded && (
                <>
                  <DropdownMenuLabel>Reason</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={reason} onValueChange={value => setReason(value as DiscardReason | 'all')}>
                    <DropdownMenuRadioItem value="all">Any reason</DropdownMenuRadioItem>
                    {DISCARD_REASONS.map(one => (
                      <DropdownMenuRadioItem key={one} value={one}>
                        {DISCARD_REASON_NAMES[one]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel>Stage</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={filters.stage} onValueChange={stage => setFilters(current => ({ ...current, stage }))}>
                <DropdownMenuRadioItem value="all">Any stage</DropdownMenuRadioItem>
                {STAGES.map(stage => (
                  <DropdownMenuRadioItem key={stage} value={stage}>
                    {capitalize(stage)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Portal</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={filters.portal} onValueChange={portal => setFilters(current => ({ ...current, portal }))}>
                <DropdownMenuRadioItem value="all">Any portal</DropdownMenuRadioItem>
                {SOURCES.map(source => (
                  <DropdownMenuRadioItem key={source} value={source}>
                    {SOURCE_NAMES[source]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Work mode</DropdownMenuLabel>
              {WORK_MODES.map(mode => (
                <DropdownMenuCheckboxItem
                  key={mode}
                  checked={modes.length === 0 || modes.includes(mode)}
                  onCheckedChange={on => toggleMode(mode, on === true)}
                  onSelect={event => event.preventDefault()}
                >
                  {WORK_MODE_NAMES[mode]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="nx:flex nx:flex-wrap nx:gap-2 nx:px-4 nx:py-2">
          {chips.map(chip => (
            <FilterChip key={chip.key} name={chip.key} value={chip.key} aria-label={`Remove ${chip.label}`} onClick={chip.clear}>
              {chip.label}
            </FilterChip>
          ))}
        </div>
      )}

      <div className="nx:px-2 nx:pb-24">
        {list.error && <ErrorNote text={list.error} />}
        {!data ? (
          <div className="nx:p-4">
            <Loading />
          </div>
        ) : isEmpty ? (
          <div className="nx:p-8">
            <EmptyState>
              <EmptyStateHeader>
                <EmptyStateTitle>{isFiltered ? 'Nothing matches' : isDiscarded ? 'Nothing discarded' : view === 'all' ? 'No jobs yet' : `No ${viewName} jobs`}</EmptyStateTitle>
                <EmptyStateDescription>
                  {isDiscarded ? 'Jobs a hunt rules out land here, with the words that ruled them out.' : view === 'found' || view === 'all' ? 'A hunt adds jobs here.' : 'Try another view.'}
                </EmptyStateDescription>
              </EmptyStateHeader>
            </EmptyState>
          </div>
        ) : isDiscarded ? (
          <DiscardedTable jobs={discarded} />
        ) : (
          <Table aria-label="Companies and their jobs" density="compact">
            <TableHeader>
              <TableRow>
                <TableSelectionHead>
                  <Checkbox
                    aria-label="Pick every job in this view"
                    checked={pickedHere === 0 ? false : pickedHere === allIds.length ? true : 'indeterminate'}
                    onCheckedChange={on => pick(allIds, on === true)}
                  />
                </TableSelectionHead>
                <TableHead>Company</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="nx:text-end">Min exp</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="nx:text-end">Best score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>
                  <Hidden>Actions</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map(row => {
                const ids = row.jobs.map(job => job.id)
                const n = ids.filter(id => picked.has(id)).length
                const expanded = isOpen(row)
                return [
                  <TableRow key={`c-${row.id}`} className="nx:group" data-state={n === ids.length && n > 0 ? 'selected' : undefined}>
                    <TableSelectionCell>
                      <Checkbox aria-label={`Pick ${row.name}`} checked={n === 0 ? false : n === ids.length ? true : 'indeterminate'} onCheckedChange={on => pick(ids, on === true)} />
                    </TableSelectionCell>
                    <TableCell>
                      <div className="nx:flex nx:items-center nx:gap-1 nx:min-w-0">
                        <Button variant="ghost" size="icon-sm" aria-label={expanded ? `Hide jobs at ${row.name}` : `Show jobs at ${row.name}`} onClick={() => toggleOpen(row)}>
                          {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
                        </Button>
                        <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground nx:whitespace-nowrap" onClick={() => go(`/company/${row.id}`)}>
                          {row.name}
                        </button>
                        <span className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{plural(row.jobCount, 'job')}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Modes jobs={row.jobs} />
                    </TableCell>
                    <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small nx:whitespace-nowrap">{yearsText(sameYears(row.jobs))}</TableCell>
                    <TableCell className="nx:typography-body-small">{capitalize(row.stage)}</TableCell>
                    <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{row.bestScore ?? ''}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="nx:typography-body-small">
                      <People row={row} />
                    </TableCell>
                    <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">{day(row.updated)}</TableCell>
                    <TableCell className="nx:text-end">
                      <div className={HOVER}>
                        <CompanyMenu row={row} />
                      </div>
                    </TableCell>
                  </TableRow>,
                  ...(expanded
                    ? row.jobs.map(job => (
                        <TableRow key={`j-${job.id}`} className="nx:group" data-state={picked.has(job.id) ? 'selected' : undefined}>
                          <TableSelectionCell>
                            <Checkbox aria-label={`Pick ${job.role}`} checked={picked.has(job.id)} onCheckedChange={on => pick([job.id], on === true)} />
                          </TableSelectionCell>
                          <TableCell>
                            <button
                              type="button"
                              className="nx:flex nx:items-center nx:gap-2 nx:min-w-0 nx:max-w-[360px] nx:pl-9 nx:bg-transparent nx:border-0 nx:py-0 nx:pr-0 nx:cursor-pointer nx:text-left"
                              onClick={() => go(`/job/${job.id}`)}
                            >
                              <span className="nx:typography-body-default nx:text-foreground nx:truncate">{job.role}</span>
                              <span className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{sourceName(job)}</span>
                              {job.postingState === 'unreadable' && (
                                <span title="Apply page not readable" aria-label="Apply page not readable" className="nx:inline-flex nx:shrink-0 nx:text-warning-subtle-foreground">
                                  <WarningIcon size={14} />
                                </span>
                              )}
                            </button>
                          </TableCell>
                          <TableCell>
                            <ModeBadge mode={job.workMode} />
                          </TableCell>
                          <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small nx:whitespace-nowrap">{yearsText(job.minYears)}</TableCell>
                          <TableCell />
                          <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{job.score ?? ''}</TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} />
                          </TableCell>
                          <TableCell />
                          <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">{day(job.updated)}</TableCell>
                          <TableCell className="nx:text-end">
                            <div className={`nx:flex nx:items-center nx:justify-end nx:gap-1 ${HOVER}`}>
                              {job.status === 'found' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  startIcon={<PaperPlaneTiltIcon />}
                                  disabled={isBusy}
                                  onClick={() => void attempt(() => api.flows.apply([job.id])).then(runId => runId && go('/run'))}
                                >
                                  Apply
                                </Button>
                              )}
                              <JobMenu job={job} />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    : []),
                ]
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {!isDiscarded && pickedJobs.length > 0 && (
        <div className="nx:fixed nx:bottom-6 nx:left-0 nx:right-0 nx:flex nx:justify-center nx:pointer-events-none">
          <div className="nx:pointer-events-auto">
            <Toolbar variant="floating" aria-label="Picked jobs">
              <span className="nx:typography-label-default nx:px-2">
                {plural(pickedJobs.length, 'job')} at {plural(pickedRows.length, 'company', 'companies')}
              </span>
              <ToolbarSeparator />
              {view === 'found' && pickedFound.length > 0 && (
                <ToolbarButton
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void applyPicked()}
                  title={pickedFound.length > 1 ? `${Math.min(AT_ONCE, pickedFound.length)} at a time, each in its own tab` : undefined}
                >
                  <PaperPlaneTiltIcon />
                  <span>Apply to {pickedFound.length}</span>
                </ToolbarButton>
              )}
              {canConnect && (
                <ToolbarButton
                  size="sm"
                  variant={view === 'applied' ? undefined : 'ghost'}
                  disabled={isBusy}
                  onClick={() => void connectPicked()}
                  title={`Up to ${REQUESTS_PER_COMPANY} new LinkedIn requests at each company, never with a note`}
                >
                  <UserPlusIcon />
                  <span>Send requests at {plural(pickedRows.length, 'company', 'companies')}</span>
                </ToolbarButton>
              )}
              {canConnect && (
                <ToolbarButton size="sm" variant="ghost" disabled={isBusy} onClick={() => void refreshPicked()} title="Reads your LinkedIn connections at each company, and who accepted your requests">
                  <ArrowsClockwiseIcon />
                  <span>Refresh connections</span>
                </ToolbarButton>
              )}
              {pickedCheckable.length > 0 && (
                <ToolbarButton
                  size="sm"
                  variant="ghost"
                  disabled={isBusy}
                  title="Reads each posting: a closed found job is marked dead"
                  onClick={() => void checkPostings(pickedCheckable.map(job => job.id)).then(clear)}
                >
                  <ListChecksIcon />
                  <span>Check {pickedCheckable.length}</span>
                </ToolbarButton>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton size="sm" variant="ghost">
                    <CircleDashedIcon />
                    <span>Set status</span>
                  </ToolbarButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top">
                  {SET_STATUSES.map(one => (
                    <DropdownMenuItem key={one} onSelect={() => void setStatusOf(pickedJobs, one, `${plural(pickedJobs.length, 'job')} set to ${STATUS_NAMES[one]}`)}>
                      {STATUS_NAMES[one]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {view === 'found' && pickedFound.length > 0 && (
                <ToolbarButton size="sm" variant="ghost" onClick={() => void setStatusOf(pickedFound, 'discarded', `${plural(pickedFound.length, 'job')} discarded`)}>
                  <ArchiveIcon />
                  <span>Discard</span>
                </ToolbarButton>
              )}
              <ToolbarSeparator />
              <ToolbarButton size="icon-sm" variant="ghost" aria-label="Clear the selection" onClick={clear}>
                <XIcon />
              </ToolbarButton>
            </Toolbar>
          </div>
        </div>
      )}

      <AddJobDialog
        open={isAdding}
        onOpenChange={on => {
          setAdding(on)
          if (!on && adding) go('/tracker')
        }}
      />
    </Page>
  )
}
