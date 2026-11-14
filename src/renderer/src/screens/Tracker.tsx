import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import {
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

import { AT_ONCE, CHECK_STATUSES, PORTAL_NAMES, PORTALS, REQUESTS_PER_COMPANY, STAGES, STATUSES, TRACKER_VIEW_NAMES, TRACKER_VIEWS, WORK_MODE_NAMES, WORK_MODES } from '../../../shared/types'
import type { CompanyQuery, CompanyRow, Preferences, TrackerRow, TrackerView, WorkMode } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { capitalize, portalName } from '../lib/format'
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

/** The modes the tracker opens on: the ones the user prefers, and jobs that don't say. Every mode when all are preferred. */
function preferredModes(prefs: Preferences): WorkMode[] {
  const wanted = WORK_MODES.filter(mode => mode !== 'not-stated' && prefs.modes[mode])
  return wanted.length === 0 || wanted.length === 3 ? [] : [...wanted, 'not-stated']
}

const modeList = (modes: WorkMode[]): string => modes.map(mode => WORK_MODE_NAMES[mode]).join(', ')

const platformOf = (job: TrackerRow): string => portalName(job.portal) || job.portal

/** A company's platforms, from its jobs in the view: the most common one, and how many others. */
function Platforms({ jobs }: { jobs: TrackerRow[] }): JSX.Element {
  const counts = new Map<string, number>()
  for (const job of jobs) counts.set(platformOf(job), (counts.get(platformOf(job)) ?? 0) + 1)
  const [top = ''] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const others = counts.size - 1
  return (
    <span className="nx:flex nx:items-center nx:gap-1 nx:min-w-0" title={[...counts.keys()].join(', ')}>
      <span className="nx:truncate">{top}</span>
      {others > 0 && <span className="nx:shrink-0 nx:text-muted-foreground">+{others}</span>}
    </span>
  )
}

const yearsText = (years: number | null | undefined): string => (typeof years === 'number' ? `${years}+ yrs` : '')

/** A company's minimum years: shown only when every job in the view asks the same. */
function sameYears(jobs: TrackerRow[]): number | null {
  const first = jobs[0]?.minYears
  return typeof first === 'number' && jobs.every(job => job.minYears === first) ? first : null
}

function ModeBadge({ mode }: { mode: WorkMode }): JSX.Element {
  return (
    <Badge variant="secondary" fill={mode === 'not-stated' ? 'outline' : 'light'} isCaps={false}>
      {WORK_MODE_NAMES[mode]}
    </Badge>
  )
}

/** A company's work modes, from its jobs in the view, in the usual order. */
function Modes({ jobs }: { jobs: TrackerRow[] }): JSX.Element {
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
  const { accepted, pending } = row.referral
  if (!accepted && !pending) return <span className="nx:text-muted-foreground">–</span>
  return (
    <span className="nx:whitespace-nowrap">
      {accepted > 0 && <span>{accepted} connected</span>}
      {accepted > 0 && pending > 0 && <span className="nx:text-muted-foreground"> · </span>}
      {pending > 0 && <span className="nx:text-muted-foreground">{pending} sent</span>}
    </span>
  )
}

function JobMenu({ job }: { job: TrackerRow }): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${job.role}`}>
          <DotsThreeIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => go(`/opportunity/${job.id}`)}>Open job</DropdownMenuItem>
        {job.link && (
          <DropdownMenuItem onSelect={() => void attempt(() => api.chrome.openUrl(job.link!))}>
            <ArrowSquareOutIcon /> Open posting
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={job.status} onValueChange={status => void attempt(() => api.tracker.setStatus(job.id, status), 'Status saved')}>
          {STATUSES.map(status => (
            <DropdownMenuRadioItem key={status} value={status}>
              {capitalize(status)}
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

/** The tracker, company first: each company with its jobs as rows beneath it. */
export function Tracker({ adding = false, view = 'all' }: { adding?: boolean; view?: TrackerView }): JSX.Element {
  const status = useAppStatus()
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const defaultModes = settings.data ? preferredModes(settings.data.preferences) : null
  const [query, setQuery] = useState<CompanyQuery>({ view, stage: 'all', portal: 'all', search: '', modes: [] })
  const [modesTouched, setModesTouched] = useState(false)
  useEffect(() => setQuery(current => ({ ...current, view })), [view])
  // Opens on the modes the user prefers, until they pick their own.
  const modes = modesTouched ? query.modes : (defaultModes ?? [])
  const shown: CompanyQuery = { ...query, modes }
  const setModes = (modes: WorkMode[]): void => {
    setModesTouched(true)
    setQuery(current => ({ ...current, modes }))
  }
  const toggleMode = (mode: WorkMode, on: boolean): void => {
    const current = modes.length ? modes : [...WORK_MODES]
    const next = WORK_MODES.filter(one => (one === mode ? on : current.includes(one)))
    if (next.length === 0) return
    setModes(next.length === WORK_MODES.length ? [] : next)
  }
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [closed, setClosed] = useState<Set<number>>(new Set())
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [isAdding, setAdding] = useState(adding)
  const list = useData(() => api.tracker.companies(shown), [JSON.stringify(shown)], ['opportunities', 'contacts'])
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  useEffect(() => {
    const timer = setTimeout(() => setQuery(current => (current.search === search ? current : { ...current, search })), 200)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => setAdding(adding), [adding])

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

  const jobsById = useMemo(() => new Map(companies.flatMap(row => row.jobs.map(job => [job.id, job] as const))), [companies])
  const pickedJobs = [...picked].map(id => jobsById.get(id)).filter((job): job is TrackerRow => !!job)
  const pickedFound = pickedJobs.filter(job => job.status === 'found')
  const isCheckable = (job: TrackerRow): boolean => (CHECK_STATUSES as readonly string[]).includes(job.status)
  const pickedCheckable = pickedJobs.filter(isCheckable)
  // Check postings reads the jobs on screen: the view, with its filters.
  const shownCheckable = companies.flatMap(row => row.jobs.filter(isCheckable).map(job => job.id))
  const pickedCompanies = new Set(pickedJobs.map(job => job.companyId)).size
  // Requests go to every picked company, before or after applying.
  const canConnect = query.view === 'found' || query.view === 'applied'
  const pickedRows = companies.filter(row => row.jobs.some(job => picked.has(job.id)))
  const pickedNames = pickedRows.map(row => row.name)
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

  const applyPicked = async (): Promise<void> => {
    if (await attempt(() => api.flows.apply(pickedFound.map(job => job.id)))) {
      setPicked(new Set())
      go('/run')
    }
  }
  const connectPicked = async (): Promise<void> => {
    if (await sendRequests(pickedNames)) setPicked(new Set())
  }
  // Refreshing stays on the tracker: the People column fills in as each company is read.
  const refreshPicked = async (): Promise<void> => {
    const n = pickedRows.length
    const runId = await attempt(() => api.flows.refreshPeople(pickedRows.map(row => row.id)), `Reading your LinkedIn connections at ${n === 1 ? pickedRows[0]!.name : `${n} companies`}`)
    if (runId) setPicked(new Set())
  }
  const setStatusPicked = async (next: string): Promise<void> => {
    await attempt(async () => {
      for (const job of pickedJobs) await api.tracker.setStatus(job.id, next)
    }, `${pickedJobs.length} ${pickedJobs.length === 1 ? 'job' : 'jobs'} set to ${next}`)
    setPicked(new Set())
  }

  const chips: { key: string; label: string; clear: () => void }[] = []
  if (query.stage !== 'all') chips.push({ key: 'stage', label: `Stage: ${capitalize(query.stage)}`, clear: () => setQuery(current => ({ ...current, stage: 'all' })) })
  if (query.portal !== 'all') chips.push({ key: 'portal', label: `Portal: ${portalName(query.portal) || 'Other'}`, clear: () => setQuery(current => ({ ...current, portal: 'all' })) })
  if (modes.length) chips.push({ key: 'mode', label: `Mode: ${modeList(modes)}`, clear: () => setModes([]) })

  return (
    <Page
      title="Tracker"
      meta={data ? `${data.totalCompanies} companies · ${data.totalJobs} jobs` : undefined}
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
        <Tabs value={query.view} onValueChange={view => setQuery(current => ({ ...current, view: view as TrackerView }))}>
          <TabsList variant="underline" size="sm">
            {TRACKER_VIEWS.map(view => (
              <TabsTrigger key={view} value={view}>
                {TRACKER_VIEW_NAMES[view]}
                <span className="nx:ml-1 nx:text-muted-foreground">{data?.counts[view] ?? ''}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="nx:flex nx:items-center nx:gap-2">
          {(query.view === 'found' || query.view === 'applied') && shownCheckable.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              startIcon={<ListChecksIcon />}
              disabled={isBusy}
              title={`Reads the ${shownCheckable.length} ${shownCheckable.length === 1 ? 'job' : 'jobs'} shown against their apply pages`}
              onClick={() => void checkPostings(shownCheckable)}
            >
              Check postings
            </Button>
          )}
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
              <DropdownMenuLabel>Stage</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={query.stage} onValueChange={stage => setQuery(current => ({ ...current, stage }))}>
                <DropdownMenuRadioItem value="all">Any stage</DropdownMenuRadioItem>
                {STAGES.map(stage => (
                  <DropdownMenuRadioItem key={stage} value={stage}>
                    {capitalize(stage)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Portal</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={query.portal} onValueChange={portal => setQuery(current => ({ ...current, portal }))}>
                <DropdownMenuRadioItem value="all">Any portal</DropdownMenuRadioItem>
                {PORTALS.map(portal => (
                  <DropdownMenuRadioItem key={portal} value={portal}>
                    {PORTAL_NAMES[portal]}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem value="other">Other sources</DropdownMenuRadioItem>
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
        ) : companies.length === 0 ? (
          <div className="nx:p-8">
            <EmptyState>
              <EmptyStateHeader>
                <EmptyStateTitle>{query.search || chips.length ? 'Nothing matches' : `No ${TRACKER_VIEW_NAMES[query.view].toLowerCase()} jobs`}</EmptyStateTitle>
                <EmptyStateDescription>{query.view === 'found' ? 'A hunt adds jobs here.' : 'Try another view.'}</EmptyStateDescription>
              </EmptyStateHeader>
            </EmptyState>
          </div>
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
                <TableHead>Platform</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="nx:text-end">Min exp</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>People</TableHead>
                <TableHead className="nx:text-end">Score</TableHead>
                <TableHead>Status</TableHead>
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
                        <span className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">
                          {row.jobCount} {row.jobCount === 1 ? 'job' : 'jobs'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="nx:typography-body-small nx:max-w-[160px]">
                      <Platforms jobs={row.jobs} />
                    </TableCell>
                    <TableCell>
                      <Modes jobs={row.jobs} />
                    </TableCell>
                    <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small nx:whitespace-nowrap">{yearsText(sameYears(row.jobs))}</TableCell>
                    <TableCell className="nx:typography-body-small">{capitalize(row.stage)}</TableCell>
                    <TableCell className="nx:typography-body-small">
                      <People row={row} />
                    </TableCell>
                    <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{row.bestScore ?? ''}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
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
                              className="nx:flex nx:items-center nx:gap-2 nx:min-w-0 nx:pl-9 nx:bg-transparent nx:border-0 nx:py-0 nx:pr-0 nx:cursor-pointer nx:text-left"
                              onClick={() => go(`/opportunity/${job.id}`)}
                            >
                              <span className="nx:typography-body-default nx:text-foreground nx:truncate">{job.role}</span>
                              {job.postingState === 'unreadable' && (
                                <span title="Apply page not readable" aria-label="Apply page not readable" className="nx:inline-flex nx:shrink-0 nx:text-warning-subtle-foreground">
                                  <WarningIcon size={14} />
                                </span>
                              )}
                            </button>
                          </TableCell>
                          <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:max-w-[160px]">
                            <span className="nx:block nx:truncate" title={platformOf(job)}>
                              {platformOf(job)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <ModeBadge mode={job.workMode} />
                          </TableCell>
                          <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small nx:whitespace-nowrap">{yearsText(job.minYears)}</TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{job.score ?? ''}</TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} />
                          </TableCell>
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

      {pickedJobs.length > 0 && (
        <div className="nx:fixed nx:bottom-6 nx:left-0 nx:right-0 nx:flex nx:justify-center nx:pointer-events-none">
          <div className="nx:pointer-events-auto">
            <Toolbar variant="floating" aria-label="Picked jobs">
              <span className="nx:typography-label-default nx:px-2">
                {pickedJobs.length} {pickedJobs.length === 1 ? 'job' : 'jobs'} at {pickedCompanies} {pickedCompanies === 1 ? 'company' : 'companies'}
              </span>
              <ToolbarSeparator />
              {/* Apply is the next step for found jobs only, so it shows once any are picked. */}
              {pickedFound.length > 0 && (
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
              {canConnect && pickedNames.length > 0 && (
                <ToolbarButton
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void connectPicked()}
                  title={`Up to ${REQUESTS_PER_COMPANY} new LinkedIn requests at each company, never with a note`}
                >
                  <UserPlusIcon />
                  <span>
                    Send requests at {pickedNames.length} {pickedNames.length === 1 ? 'company' : 'companies'}
                  </span>
                </ToolbarButton>
              )}
              {canConnect && pickedRows.length > 0 && (
                <ToolbarButton
                  size="sm"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => void refreshPicked()}
                  title="Reads your LinkedIn connections at each company, and who accepted your requests"
                >
                  <ArrowsClockwiseIcon />
                  <span>Refresh connections</span>
                </ToolbarButton>
              )}
              <ToolbarButton size="sm" variant="ghost" disabled={isBusy || pickedCheckable.length === 0} onClick={() => void checkPostings(pickedCheckable.map(job => job.id)).then(() => setPicked(new Set()))}>
                <ListChecksIcon />
                <span>Check {pickedCheckable.length}</span>
              </ToolbarButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton size="sm" variant="ghost">
                    <CircleDashedIcon />
                    <span>Set status</span>
                  </ToolbarButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top">
                  {STATUSES.map(one => (
                    <DropdownMenuItem key={one} onSelect={() => void setStatusPicked(one)}>
                      {capitalize(one)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <ToolbarSeparator />
              <ToolbarButton size="icon-sm" variant="ghost" aria-label="Clear the selection" onClick={() => setPicked(new Set())}>
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
