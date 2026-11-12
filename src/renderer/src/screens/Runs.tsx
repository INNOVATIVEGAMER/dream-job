import { useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'

import { FLOW_NAMES, FLOWS, PORTAL_NAMES, PORTALS } from '../../../shared/types'
import type { RunQuery } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { duration, portalName, tokens, when } from '../lib/format'
import { go } from '../lib/router'
import { Activity, ErrorNote, Loading, Page, RunStatusBadge } from '../ui/common'
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

function RunDetailCard({ id }: { id: number }): JSX.Element {
  const detail = useData(() => api.runs.get(id), [id], ['runs'])
  if (detail.error) return <ErrorNote text={detail.error} />
  if (!detail.data) return <Loading />
  const { summary, events } = detail.data
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Run {summary.id}: {summary.title}
        </CardTitle>
        <CardDescription>{summary.result ?? 'The full activity of the run.'}</CardDescription>
        {summary.opportunityId && (
          <CardAction>
            <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go(`/opportunity/${summary.opportunityId}`)}>
              Open the row
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <Activity events={events} limit={500} />
      </CardContent>
    </Card>
  )
}

/** Every flow run: what it did, how long it took, and what it used of the Claude plan. */
export function Runs({ selected }: { selected: number | null }): JSX.Element {
  const [query, setQuery] = useState<RunQuery>({ flow: 'all', portal: 'all', page: 0 })
  const page = useData(() => api.runs.page(query), [JSON.stringify(query)], ['runs'])
  const data = page.data
  const shown = selected ?? data?.rows[0]?.id ?? null

  return (
    <Page title="Run history" description="Every flow run, with what it did, how long it took and what it used of your Claude plan.">
      <div className="nx:flex nx:flex-wrap nx:gap-2 nx:items-center">
        <NativeSelect aria-label="Flow" value={query.flow} onChange={event => setQuery(current => ({ ...current, flow: event.target.value, page: 0 }))}>
          <NativeSelectOption value="all">All flows</NativeSelectOption>
          {FLOWS.map(flow => (
            <NativeSelectOption key={flow} value={flow}>
              {FLOW_NAMES[flow]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Portal" value={query.portal} onChange={event => setQuery(current => ({ ...current, portal: event.target.value, page: 0 }))}>
          <NativeSelectOption value="all">All portals</NativeSelectOption>
          {PORTALS.map(portal => (
            <NativeSelectOption key={portal} value={portal}>
              {PORTAL_NAMES[portal]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {page.error && <ErrorNote text={page.error} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          <Table aria-label="Runs" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="nx:text-end">Took</TableHead>
                <TableHead className="nx:text-end">Turns</TableHead>
                <TableHead className="nx:text-end">Tokens in, out</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(run => (
                <TableRow key={run.id} className="nx:cursor-pointer" data-state={run.id === shown ? 'selected' : undefined} onClick={() => go(`/runs/${run.id}`)}>
                  <TableCell>
                    <div className="nx:flex nx:flex-col">
                      <span className="nx:typography-label-default">
                        {run.id} {run.title}
                      </span>
                      <span className="nx:typography-body-small nx:text-muted-foreground">{portalName(run.portal) || FLOW_NAMES[run.flow]}</span>
                    </div>
                  </TableCell>
                  <TableCell className="nx:tabular-nums">{when(run.started)}</TableCell>
                  <TableCell className="nx:text-end nx:tabular-nums">{run.usage.ms ? duration(run.usage.ms) : ''}</TableCell>
                  <TableCell className="nx:text-end nx:tabular-nums">{run.usage.turns || ''}</TableCell>
                  <TableCell className="nx:text-end nx:tabular-nums">
                    {run.usage.inputTokens ? `${tokens(run.usage.inputTokens)}, ${tokens(run.usage.outputTokens)}` : ''}
                  </TableCell>
                  <TableCell>
                    <div className="nx:flex nx:flex-col nx:gap-1">
                      <RunStatusBadge status={run.status} />
                      {run.result && <span className="nx:typography-body-small nx:text-muted-foreground">{run.result}</span>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="nx:text-muted-foreground">
                    No runs yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-2">
            <span className="nx:typography-body-small nx:text-muted-foreground">
              {data.total} runs, page {data.page + 1} of {data.pages}
            </span>
            <div className="nx:flex nx:gap-2">
              <Button variant="outline" size="sm" startIcon={<CaretLeftIcon />} disabled={data.page === 0} onClick={() => setQuery(current => ({ ...current, page: data.page - 1 }))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" endIcon={<CaretRightIcon />} disabled={data.page >= data.pages - 1} onClick={() => setQuery(current => ({ ...current, page: data.page + 1 }))}>
                Next
              </Button>
            </div>
          </div>
          {shown && <RunDetailCard id={shown} />}
        </>
      )}
    </Page>
  )
}
