import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { CaretLeftIcon, CaretRightIcon, EnvelopeIcon, PaperPlaneTiltIcon, PlusIcon } from '@phosphor-icons/react'

import { PORTAL_NAMES, PORTALS, STAGES, STATUSES } from '../../../shared/types'
import type { TrackerQuery } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { capitalize, day, portalName } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, ErrorNote, Hidden, Loading, Page, StatusBadge } from '../ui/common'
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

/** The tracker: every opportunity, filtered, a page at a time. */
export function Tracker(): JSX.Element {
  const status = useAppStatus()
  const [query, setQuery] = useState<TrackerQuery>({ status: 'all', stage: 'all', portal: 'all', search: '', page: 0 })
  const [search, setSearch] = useState('')
  const page = useData(() => api.tracker.page(query), [JSON.stringify(query)], ['opportunities'])
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  // Searching waits for a pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(current => (current.search === search ? current : { ...current, search, page: 0 })), 250)
    return () => clearTimeout(timer)
  }, [search])

  const set = (patch: Partial<TrackerQuery>): void => setQuery(current => ({ ...current, ...patch, page: patch.page ?? 0 }))
  const apply = async (rowId: number): Promise<void> => {
    if (await attempt(() => api.flows.apply(rowId))) go('/run')
  }
  const data = page.data
  const first = data && data.total > 0 ? data.page * data.pageSize + 1 : 0
  const last = data ? data.page * data.pageSize + data.rows.length : 0

  return (
    <Page
      title="Tracker"
      description={`Every opportunity from the hunt onward, newest touch first.${data ? ` ${data.all} rows.` : ''}`}
      actions={
        <>
          <Button variant="outline" startIcon={<EnvelopeIcon />} onClick={() => go('/email')}>
            Update from Gmail
          </Button>
          <Button variant="outline" startIcon={<PlusIcon />} onClick={() => go('/tracker/new')}>
            Add a row
          </Button>
          <Button
            startIcon={<PaperPlaneTiltIcon />}
            disabled={isBusy || !data?.counts['found']}
            onClick={() => void attempt(() => api.home()).then(home => home?.nextFound && apply(home.nextFound.id))}
          >
            Apply to next found
          </Button>
        </>
      }
    >
      <div className="nx:flex nx:flex-wrap nx:gap-2 nx:items-center">
        <div className="nx:min-w-0" style={{ flex: '1 1 240px' }}>
          <Input type="search" aria-label="Search company or role" placeholder="Search company or role" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <NativeSelect aria-label="Status" value={query.status} onChange={event => set({ status: event.target.value })}>
          <NativeSelectOption value="all">All statuses ({data?.all ?? 0})</NativeSelectOption>
          {STATUSES.map(one => (
            <NativeSelectOption key={one} value={one}>
              {capitalize(one)} ({data?.counts[one] ?? 0})
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Stage" value={query.stage} onChange={event => set({ stage: event.target.value })}>
          <NativeSelectOption value="all">All stages</NativeSelectOption>
          {STAGES.map(one => (
            <NativeSelectOption key={one} value={one}>
              {capitalize(one)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Portal" value={query.portal} onChange={event => set({ portal: event.target.value })}>
          <NativeSelectOption value="all">All portals</NativeSelectOption>
          {PORTALS.map(one => (
            <NativeSelectOption key={one} value={one}>
              {PORTAL_NAMES[one]}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="other">Other sources</NativeSelectOption>
        </NativeSelect>
      </div>

      {page.error && <ErrorNote text={page.error} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          <Table aria-label="Opportunities" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Company and role</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Portal</TableHead>
                <TableHead className="nx:text-end">Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last touch</TableHead>
                <TableHead>
                  <Hidden>Actions</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>
                    <button type="button" className="nx:flex nx:flex-col nx:text-left nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer" onClick={() => go(`/opportunity/${row.id}`)}>
                      <span className="nx:typography-label-default nx:text-foreground">{row.company}</span>
                      <span className="nx:typography-body-small nx:text-muted-foreground">{row.role}</span>
                    </button>
                  </TableCell>
                  <TableCell>{capitalize(row.stage)}</TableCell>
                  <TableCell>{portalName(row.portal)}</TableCell>
                  <TableCell className="nx:text-end nx:tabular-nums">{row.score ?? ''}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="nx:tabular-nums">{day(row.lastTouch)}</TableCell>
                  <TableCell className="nx:text-end">
                    {row.status === 'found' ? (
                      <Button variant="outline" size="sm" startIcon={<PaperPlaneTiltIcon />} disabled={isBusy} onClick={() => void apply(row.id)}>
                        Apply
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" endIcon={<CaretRightIcon />} onClick={() => go(`/opportunity/${row.id}`)}>
                        Open
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="nx:text-muted-foreground">
                    No opportunities match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-2">
            <span className="nx:typography-body-small nx:text-muted-foreground">
              {first} to {last} of {data.total}, page {data.page + 1} of {data.pages}
            </span>
            <div className="nx:flex nx:gap-2">
              <Button variant="outline" size="sm" startIcon={<CaretLeftIcon />} disabled={data.page === 0} onClick={() => set({ page: data.page - 1 })}>
                Previous
              </Button>
              <Button variant="outline" size="sm" endIcon={<CaretRightIcon />} disabled={data.page >= data.pages - 1} onClick={() => set({ page: data.page + 1 })}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
