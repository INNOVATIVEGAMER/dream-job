import { useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'

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
  ListChecksIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  StarHalfIcon,
  StarIcon,
  UserPlusIcon,
  WarningIcon,
  XCircleIcon,
  XIcon,
} from '@phosphor-icons/react'

import { askBlock, experienceMonths, maxAskableYears } from '../../../shared/profile'
import {
  AT_ONCE,
  CHECK_STATUSES,
  DISCARD_REASON_NAMES,
  DISCARD_REASONS,
  EMPLOYER_NAMES,
  EMPLOYERS,
  EXPERIENCE_FIT_NAMES,
  EXPERIENCE_FITS,
  REQUESTS_PER_COMPANY,
  SOURCE_NAMES,
  SOURCES,
  STAGES,
  STATUS_NAMES,
  STATUSES,
  TRACKER_VIEW_NAMES,
  WORK_MODE_NAMES,
  WORK_MODES,
  isTrackerTab,
} from '../../../shared/types'
import type {
  CompanyList,
  CompanyQuery,
  CompanyRow,
  DiscardReason,
  Employer,
  ExperienceFit,
  JobRow,
  Preferences,
  Source,
  Stage,
  Status,
  TrackerTab,
  WorkMode,
} from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { capitalize, day, plural } from '../lib/format'
import { go, replace } from '../lib/router'
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
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

/** Ticks one choice on or off. None ticked, or every one, is no filter at all, so that comes back empty. */
function toggled<T extends string>(all: readonly T[], chosen: readonly T[], value: T, on: boolean): T[] {
  const next = all.filter(one => (one === value ? on : chosen.includes(one)))
  return next.length === all.length ? [] : next
}

/** Names that fit in a filter chip: the first two, then how many more. */
const fitList = (names: string[]): string => (names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', '))

const sourceName = (job: JobRow): string => SOURCE_NAMES[job.portal] ?? job.portal

const yearsText = (years: number | null | undefined): string => (typeof years === 'number' ? `${years}+ yrs` : '')

/** The years a job asks for, marked when they are too many to ask anyone for a referral. */
function Years({ years, months }: { years: number | null; months: number | null }): JSX.Element {
  const block = askBlock(years, months)
  return (
    <span title={block ? `${block}: too many to ask for a referral` : undefined} className={block ? 'nx:text-warning-subtle-foreground' : undefined}>
      {yearsText(years)}
    </span>
  )
}

/** A company's minimum years: shown only when every job in the view asks the same. */
function sameYears(jobs: JobRow[]): number | null {
  const first = jobs[0]?.minYears
  return typeof first === 'number' && jobs.every(job => job.minYears === first) ? first : null
}

/** The tab's number: companies in each view, but jobs in Discarded, which lists jobs. */
const countOf = (data: CompanyList | undefined, view: TrackerTab): number | string => (data ? (view === 'discarded' ? data.discardedJobs : data.counts[view]) : '')

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

/**
 * The star on a job, or on a company for its jobs in the view: filled when
 * every one is starred, half when some are. A click stars them all, or takes
 * the star off when all have it.
 */
function StarButton({ jobs, label }: { jobs: JobRow[]; label: string }): JSX.Element {
  const starred = jobs.filter(job => job.starred).length
  const isAll = starred > 0 && starred === jobs.length
  const isSome = starred > 0 && !isAll
  const look = starred > 0 ? 'nx:text-warning-background' : 'nx:text-muted-foreground'
  return (
    <button
      type="button"
      aria-label={isAll ? `Unstar ${label}` : `Star ${label}`}
      aria-pressed={isAll ? true : isSome ? 'mixed' : false}
      title={isAll ? 'Starred' : isSome ? `${starred} of ${jobs.length} starred` : 'Star'}
      className={`nx:flex nx:size-7 nx:items-center nx:justify-center nx:p-0 nx:border-0 nx:rounded-md nx:bg-transparent nx:hover:bg-background-hover nx:cursor-pointer ${look}`}
      onClick={() => void attempt(() => api.tracker.setStarred(jobs.map(job => job.id), !isAll))}
    >
      {isSome ? <StarHalfIcon size={16} weight="fill" /> : <StarIcon size={16} weight={isAll ? 'fill' : 'regular'} />}
    </button>
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

/** The tabs a job moves through, in order. Closed and Discarded are where jobs leave. */
const PIPELINE: TrackerTab[] = ['found', 'applied', 'outreached', 'referred', 'interview', 'offer']
const EXITS: { tab: TrackerTab; icon: JSX.Element }[] = [
  { tab: 'closed', icon: <XCircleIcon /> },
  { tab: 'discarded', icon: <ArchiveIcon /> },
]

/** One filter as the rail shows it: what it is set to, the choices that change it, and how to take it off. */
type RailFilter = {
  key: string
  name: string
  isOn: boolean
  /** The whole value, and the part that fits in the chip. */
  value: string
  short: string
  /** Several choices at once (Mode), or one. */
  isMulti: boolean
  choices: { value: string; label: string }[]
  chosen: string[]
  choose: (value: string, on: boolean) => void
  clear: () => void
}

/** A filter that is on: its name, its value (click to change it there), and × to take it off. */
function RailFilterChip({ filter }: { filter: RailFilter }): JSX.Element {
  return (
    <div className="nx:flex nx:items-stretch nx:h-8 nx:box-border nx:rounded-md nx:border-default nx:border-border-default nx:bg-background">
      <span className="nx:flex nx:shrink-0 nx:items-center nx:px-2 nx:typography-body-small nx:text-muted-foreground nx:border-r-default nx:border-border-default">{filter.name}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={filter.value}
            aria-label={`Change ${filter.name}: ${filter.value}`}
            className="nx:flex nx:flex-1 nx:min-w-0 nx:items-center nx:px-2 nx:border-0 nx:bg-transparent nx:hover:bg-background-hover nx:data-[state=open]:bg-muted nx:text-foreground nx:text-left nx:cursor-pointer"
          >
            <span className="nx:truncate nx:typography-label-small">{filter.short}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="nx:min-w-[204px]">
          <DropdownMenuLabel>{filter.isMulti ? 'Any of these' : `One ${filter.name.toLowerCase()}`}</DropdownMenuLabel>
          {filter.isMulti ? (
            filter.choices.map(choice => (
              <DropdownMenuCheckboxItem
                key={choice.value}
                checked={filter.chosen.includes(choice.value)}
                onCheckedChange={on => filter.choose(choice.value, on === true)}
                onSelect={event => event.preventDefault()}
              >
                {choice.label}
              </DropdownMenuCheckboxItem>
            ))
          ) : (
            <DropdownMenuRadioGroup value={filter.chosen[0]} onValueChange={value => filter.choose(value, true)}>
              {filter.choices.map(choice => (
                <DropdownMenuRadioItem key={choice.value} value={choice.value}>
                  {choice.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={`Remove ${filter.name} filter`}
        className="nx:flex nx:w-7 nx:shrink-0 nx:items-center nx:justify-center nx:border-0 nx:border-l-default nx:border-border-default nx:rounded-r-md nx:bg-transparent nx:hover:bg-background-hover nx:text-muted-foreground nx:cursor-pointer"
        onClick={filter.clear}
      >
        <XIcon size={14} />
      </button>
    </div>
  )
}

/** The filters under the pipeline: each one that is on as a chip, Add filter for the rest, and Clear all. */
function RailFilters({ filters }: { filters: RailFilter[] }): JSX.Element {
  const on = filters.filter(filter => filter.isOn)
  const off = filters.filter(filter => !filter.isOn)
  return (
    <>
      <div aria-hidden="true" className="nx:h-px nx:mx-2 nx:my-3 nx:bg-border-default" />
      <div className="nx:flex nx:items-center nx:justify-between nx:gap-2 nx:px-2 nx:py-1">
        <span className="nx:typography-label-small nx:text-muted-foreground">Filters</span>
        {on.length > 0 && (
          <button
            type="button"
            className="nx:p-0 nx:border-0 nx:bg-transparent nx:cursor-pointer nx:typography-label-small nx:text-muted-foreground nx:underline nx:underline-offset-[3px]"
            onClick={() => on.forEach(filter => filter.clear())}
          >
            Clear all
          </button>
        )}
      </div>
      <div className="nx:flex nx:flex-col nx:gap-[6px]">
        {on.map(filter => (
          <RailFilterChip key={filter.key} filter={filter} />
        ))}
        {off.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="nx:flex nx:items-center nx:gap-1 nx:h-8 nx:box-border nx:px-2 nx:rounded-md nx:border-dashed nx:border-default nx:border-border-default nx:bg-transparent nx:hover:bg-background-hover nx:text-muted-foreground nx:cursor-pointer nx:typography-label-small"
              >
                <PlusIcon size={14} /> Add filter
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="nx:min-w-[204px]">
              {off.map(filter => (
                <DropdownMenuSub key={filter.key}>
                  <DropdownMenuSubTrigger>{filter.name}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {filter.choices.map(choice => (
                      <DropdownMenuItem key={choice.value} onSelect={() => filter.choose(choice.value, true)}>
                        {choice.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </>
  )
}

/** The tabs down the left: the pipeline on a line from Found to Offer, Closed and Discarded below it, then the filters. */
function PipelineRail({ view, data, children }: { view: TrackerTab; data: CompanyList | undefined; children?: ReactNode }): JSX.Element {
  const item = (tab: TrackerTab, mark: JSX.Element): JSX.Element => {
    const isOn = tab === view
    const count = countOf(data, tab)
    const look = isOn ? 'nx:bg-primary-subtle nx:text-primary-subtle-foreground' : `nx:bg-transparent nx:hover:bg-background-hover ${count === 0 ? 'nx:text-muted-foreground' : 'nx:text-foreground'}`
    return (
      <button
        key={tab}
        type="button"
        aria-current={isOn ? 'page' : undefined}
        className={`nx:relative nx:flex nx:items-center nx:gap-2 nx:h-9 nx:px-2 nx:border-0 nx:rounded-md nx:cursor-pointer nx:text-left nx:typography-label-default ${look}`}
        onClick={() => go(`/tracker/${tab}`)}
      >
        <span aria-hidden="true" className="nx:flex nx:w-4 nx:shrink-0 nx:justify-center">
          {mark}
        </span>
        <span className="nx:flex-1 nx:min-w-0 nx:truncate">{TRACKER_VIEW_NAMES[tab]}</span>
        <span className={`nx:typography-body-small nx:tabular-nums ${isOn ? '' : 'nx:text-muted-foreground'}`}>{count}</span>
      </button>
    )
  }
  const dot = (tab: TrackerTab): JSX.Element => {
    const color = tab === view ? 'var(--nx-color-primary-background)' : 'var(--nx-color-muted-foreground)'
    return <span style={{ width: 10, height: 10, boxSizing: 'border-box', borderRadius: 999, border: `2px solid ${color}`, background: tab === view ? color : 'var(--nx-color-background)' }} />
  }
  return (
    <aside className="nx:w-[220px] nx:shrink-0 nx:box-border nx:border-r-default nx:border-border-default">
      <nav aria-label="Tracker tabs and filters" className="nx:sticky nx:top-12 nx:max-h-[calc(100svh-3rem)] nx:overflow-y-auto nx:box-border nx:flex nx:flex-col nx:gap-1 nx:px-2 nx:py-3">
        <span className="nx:typography-label-small nx:text-muted-foreground nx:px-2 nx:py-1">Pipeline</span>
        <div className="nx:relative nx:flex nx:flex-col nx:gap-[2px]">
          <span aria-hidden="true" className="nx:absolute nx:left-[15px] nx:top-[18px] nx:bottom-[18px] nx:w-[2px] nx:bg-border-default" />
          {PIPELINE.map(tab => item(tab, dot(tab)))}
        </div>
        <div aria-hidden="true" className="nx:h-px nx:mx-2 nx:my-3 nx:bg-border-default" />
        <span className="nx:typography-label-small nx:text-muted-foreground nx:px-2 nx:py-1">Out of the pipeline</span>
        {EXITS.map(({ tab, icon }) => item(tab, icon))}
        {children}
      </nav>
    </aside>
  )
}

type Filters = Omit<CompanyQuery, 'view' | 'modes'>

const LAST_TAB_KEY = 'dream-job:tracker-tab'

/** The tab the tracker was last on, remembered between screens and launches; Found the first time. */
function lastTab(): TrackerTab {
  try {
    const saved = localStorage.getItem(LAST_TAB_KEY) ?? undefined
    return isTrackerTab(saved) ? saved : 'found'
  } catch {
    return 'found'
  }
}

/**
 * The tracker at its address. `/tracker/applied` opens Applied and remembers it;
 * `/tracker` opens the tab last open, and the address follows so it names the tab.
 */
export function TrackerRoute({ part }: { part?: string }): JSX.Element {
  const view = isTrackerTab(part) ? part : lastTab()
  useEffect(() => {
    try {
      localStorage.setItem(LAST_TAB_KEY, view)
    } catch {
      // not remembered; the tracker opens on Found next time
    }
    if (part !== view && part !== 'new') replace(`/tracker/${view}`)
  }, [part, view])
  return <Tracker adding={part === 'new'} view={view} />
}

/** The tracker, company first: each company with its jobs as rows beneath it. Discarded lists jobs, with why. */
function Tracker({ adding = false, view }: { adding?: boolean; view: TrackerTab }): JSX.Element {
  const status = useAppStatus()
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const months = settings.data ? experienceMonths(settings.data.profile) : null
  const defaultModes = settings.data ? preferredModes(settings.data.preferences) : null
  const [filters, setFilters] = useState<Filters>({ stages: [], portals: [], search: '', employers: [], experience: [], starred: null })
  const [pickedModes, setPickedModes] = useState<WorkMode[] | null>(null)
  const [reason, setReason] = useState<DiscardReason | 'all'>('all')
  // Opens on the modes the user prefers, until they pick their own.
  const modes = pickedModes ?? defaultModes ?? []
  // Discarded jobs show no star, so the star filter waits there.
  const shown: CompanyQuery = { ...filters, view, modes, starred: view === 'discarded' ? null : filters.starred }
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
  const isAllStarred = pickedJobs.length > 0 && pickedJobs.every(job => job.starred)
  const starPicked = async (): Promise<void> => {
    const next = !isAllStarred
    await attempt(() => api.tracker.setStarred(pickedJobs.map(job => job.id), next), `${plural(pickedJobs.length, 'job')} ${next ? 'starred' : 'unstarred'}`)
    clear()
  }
  const setStatusOf = async (jobs: JobRow[], next: Status, done: string): Promise<void> => {
    await attempt(async () => {
      for (const job of jobs) await api.tracker.setStatus(job.id, next)
    }, done)
    clear()
  }

  const sizeNames = filters.stages.map(stage => capitalize(stage))
  const portalNames = filters.portals.map(portal => SOURCE_NAMES[portal])
  const employerNames = filters.employers.map(one => EMPLOYER_NAMES[one])
  const fitNames = filters.experience.map(one => EXPERIENCE_FIT_NAMES[one])
  const starName = filters.starred === null ? '' : filters.starred ? 'Starred' : 'Not starred'
  // The choices carry the years that split them, by the same rule as referral asks: up to a year past the user's.
  const most = maxAskableYears(months)
  const fitLabel = (fit: ExperienceFit): string =>
    most === null || fit === 'not-stated' ? EXPERIENCE_FIT_NAMES[fit] : `${EXPERIENCE_FIT_NAMES[fit]} (${fit === 'within' ? `up to ${most} yrs` : `${most + 1}+ yrs`})`
  const railFilters: RailFilter[] = [
    ...(isDiscarded
      ? [
          {
            key: 'reason',
            name: 'Reason',
            isOn: reason !== 'all',
            value: reason === 'all' ? '' : DISCARD_REASON_NAMES[reason],
            short: reason === 'all' ? '' : DISCARD_REASON_NAMES[reason],
            isMulti: false,
            choices: DISCARD_REASONS.map(one => ({ value: one, label: DISCARD_REASON_NAMES[one] })),
            chosen: [reason],
            choose: (value: string) => setReason(value as DiscardReason),
            clear: () => setReason('all'),
          },
        ]
      : [
          {
            key: 'star',
            name: 'Star',
            isOn: filters.starred !== null,
            value: starName,
            short: starName,
            isMulti: false,
            choices: [
              { value: 'starred', label: 'Starred' },
              { value: 'unstarred', label: 'Not starred' },
            ],
            chosen: filters.starred === null ? [] : [filters.starred ? 'starred' : 'unstarred'],
            choose: (value: string) => setFilters(current => ({ ...current, starred: value === 'starred' })),
            clear: () => setFilters(current => ({ ...current, starred: null })),
          },
        ]),
    {
      key: 'mode',
      name: 'Mode',
      isOn: modes.length > 0,
      value: modeList(modes),
      short: fitList(modes.map(mode => WORK_MODE_NAMES[mode])),
      isMulti: true,
      choices: WORK_MODES.map(mode => ({ value: mode, label: WORK_MODE_NAMES[mode] })),
      chosen: modes,
      choose: (value, on) => setPickedModes(toggled(WORK_MODES, modes, value as WorkMode, on)),
      clear: () => setPickedModes([]),
    },
    {
      key: 'size',
      name: 'Size',
      isOn: filters.stages.length > 0,
      value: sizeNames.join(', '),
      short: fitList(sizeNames),
      isMulti: true,
      choices: STAGES.map(stage => ({ value: stage, label: capitalize(stage) })),
      chosen: filters.stages,
      choose: (value, on) => setFilters(current => ({ ...current, stages: toggled(STAGES, current.stages, value as Stage, on) })),
      clear: () => setFilters(current => ({ ...current, stages: [] })),
    },
    {
      key: 'portal',
      name: 'Portal',
      isOn: filters.portals.length > 0,
      value: portalNames.join(', '),
      short: fitList(portalNames),
      isMulti: true,
      choices: SOURCES.map(source => ({ value: source, label: SOURCE_NAMES[source] })),
      chosen: filters.portals,
      choose: (value, on) => setFilters(current => ({ ...current, portals: toggled(SOURCES, current.portals, value as Source, on) })),
      clear: () => setFilters(current => ({ ...current, portals: [] })),
    },
    {
      key: 'experience',
      name: 'Experience',
      isOn: filters.experience.length > 0,
      value: filters.experience.map(fitLabel).join(', '),
      short: fitList(fitNames),
      isMulti: true,
      choices: EXPERIENCE_FITS.map(fit => ({ value: fit, label: fitLabel(fit) })),
      chosen: filters.experience,
      choose: (value, on) => setFilters(current => ({ ...current, experience: toggled(EXPERIENCE_FITS, current.experience, value as ExperienceFit, on) })),
      clear: () => setFilters(current => ({ ...current, experience: [] })),
    },
    {
      key: 'employer',
      name: 'Employer',
      isOn: filters.employers.length > 0,
      value: employerNames.join(', '),
      short: fitList(employerNames),
      isMulti: true,
      choices: EMPLOYERS.map(one => ({ value: one, label: one === 'undisclosed' ? 'Undisclosed (via a firm)' : EMPLOYER_NAMES[one] })),
      chosen: filters.employers,
      choose: (value, on) => setFilters(current => ({ ...current, employers: toggled(EMPLOYERS, current.employers, value as Employer, on) })),
      clear: () => setFilters(current => ({ ...current, employers: [] })),
    },
  ]
  const isFiltered = !!filters.search || railFilters.some(filter => filter.isOn)
  // The tab's counts are its totals; the list is what the filters and search let through.
  const total = data ? (isDiscarded ? plural(data.discardedJobs, 'job') : plural(data.counts[view], 'company', 'companies')) : ''
  const summary = `${isFiltered ? `${isDiscarded ? discarded.length : companies.length} of ` : ''}${total}${isDiscarded ? ' a hunt ruled out' : ''}`
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
      <div className="nx:flex nx:flex-1 nx:items-stretch nx:min-h-0">
        <PipelineRail view={view} data={data}>
          <RailFilters filters={railFilters} />
        </PipelineRail>
        <div className="nx:flex-1 nx:min-w-0">
          <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-3 nx:px-4 nx:py-2">
            <div className="nx:flex nx:items-baseline nx:gap-2 nx:min-w-0">
              <span className="nx:typography-label-default">{TRACKER_VIEW_NAMES[view]}</span>
              {data && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{summary}</span>}
            </div>
            <div className="nx:w-60">
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <MagnifyingGlassIcon />
                </InputGroupAddon>
                <InputGroupInput type="search" aria-label="Search companies and roles" placeholder="Search companies and roles" value={search} onChange={event => setSearch(event.target.value)} />
              </InputGroup>
            </div>
          </div>

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
                    <EmptyStateTitle>{isFiltered ? 'Nothing matches' : isDiscarded ? 'Nothing discarded' : `No ${viewName} jobs`}</EmptyStateTitle>
                    <EmptyStateDescription>
                      {isDiscarded ? 'Jobs a hunt rules out land here, with the words that ruled them out.' : view === 'found' ? 'A hunt adds jobs here.' : 'Try another tab.'}
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
                    <TableHead className="nx:w-0 nx:pe-0">
                      <Hidden>Star</Hidden>
                    </TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="nx:text-end">Min exp</TableHead>
                    <TableHead>Size</TableHead>
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
                        <TableCell className="nx:w-0 nx:pe-0">
                          <StarButton jobs={row.jobs} label={row.jobs.length === 1 ? `${row.jobs[0]!.role} at ${row.name}` : `the ${plural(row.jobs.length, 'job')} at ${row.name}`} />
                        </TableCell>
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
                        <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small nx:whitespace-nowrap"><Years years={sameYears(row.jobs)} months={months} /></TableCell>
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
                              <TableCell className="nx:w-0 nx:pe-0">
                                <StarButton jobs={[job]} label={`${job.role} at ${job.company}`} />
                              </TableCell>
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
                              <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small nx:whitespace-nowrap"><Years years={job.minYears} months={months} /></TableCell>
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
        </div>
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
              <ToolbarButton size="sm" variant="ghost" onClick={() => void starPicked()}>
                <StarIcon weight={isAllStarred ? 'regular' : 'fill'} />
                <span>{isAllStarred ? 'Unstar' : 'Star'}</span>
              </ToolbarButton>
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
