import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CircleDashedIcon,
  DotsThreeIcon,
  EnvelopeIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AT_ONCE, PORTAL_NAMES, PORTALS, STAGES, STATUSES, TRACKER_VIEW_NAMES, TRACKER_VIEWS } from '../../../shared/types'
import type { CompanyQuery, CompanyRow, TrackerRow, TrackerView } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { capitalize, day, portalName } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { applyToNext } from '../ui/CommandMenu'
import { attempt, ErrorNote, Hidden, Loading, Page, StatusBadge } from '../ui/common'
import {
  Button,
  Checkbox,
  DropdownMenu,
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

function referralLine(row: CompanyRow): string {
  const parts = (['referred', 'accepted', 'messaged', 'pending'] as const).filter(state => row.referral[state] > 0).map(state => `${row.referral[state]} ${state}`)
  return parts.slice(0, 2).join(' · ') || '–'
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
  const [query, setQuery] = useState<CompanyQuery>({ view, stage: 'all', portal: 'all', search: '' })
  useEffect(() => setQuery(current => ({ ...current, view })), [view])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [closed, setClosed] = useState<Set<number>>(new Set())
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [isAdding, setAdding] = useState(adding)
  const list = useData(() => api.tracker.companies(query), [JSON.stringify(query)], ['opportunities', 'contacts'])
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
  const pickedCompanies = new Set(pickedJobs.map(job => job.companyId)).size
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
  const setStatusPicked = async (next: string): Promise<void> => {
    await attempt(async () => {
      for (const job of pickedJobs) await api.tracker.setStatus(job.id, next)
    }, `${pickedJobs.length} ${pickedJobs.length === 1 ? 'job' : 'jobs'} set to ${next}`)
    setPicked(new Set())
  }

  const chips: { key: string; label: string; clear: () => void }[] = []
  if (query.stage !== 'all') chips.push({ key: 'stage', label: `Stage: ${capitalize(query.stage)}`, clear: () => setQuery(current => ({ ...current, stage: 'all' })) })
  if (query.portal !== 'all') chips.push({ key: 'portal', label: `Portal: ${portalName(query.portal) || 'Other'}`, clear: () => setQuery(current => ({ ...current, portal: 'all' })) })

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
          <Button size="sm" startIcon={<PaperPlaneTiltIcon />} disabled={isBusy || !data?.counts.found} onClick={() => void applyToNext()}>
            Apply to next
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
                <TableHead>Stage</TableHead>
                <TableHead className="nx:text-end">Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Referral</TableHead>
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
                        <span className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">
                          {row.jobCount} {row.jobCount === 1 ? 'job' : 'jobs'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="nx:typography-body-small">{capitalize(row.stage)}</TableCell>
                    <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{row.bestScore ?? ''}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{referralLine(row)}</TableCell>
                    <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">{day(row.updated)}</TableCell>
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
                              <span className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{portalName(job.portal) || job.portal}</span>
                            </button>
                          </TableCell>
                          <TableCell />
                          <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{job.score ?? ''}</TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} />
                          </TableCell>
                          <TableCell />
                          <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">{day(job.lastTouch)}</TableCell>
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
              <ToolbarButton
                size="sm"
                disabled={isBusy || pickedFound.length === 0}
                onClick={() => void applyPicked()}
                title={pickedFound.length > 1 ? `${Math.min(AT_ONCE, pickedFound.length)} at a time, each in its own tab` : undefined}
              >
                <PaperPlaneTiltIcon />
                <span>Apply to {pickedFound.length}</span>
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
