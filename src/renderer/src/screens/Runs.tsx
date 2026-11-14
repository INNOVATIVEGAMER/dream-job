import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

import {
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  DotOutlineIcon,
  EnvelopeIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  UserPlusIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react'

import { FLOW_NAMES, FLOWS } from '../../../shared/types'
import type { RunEvent, RunQuery } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { duration, tokens, when } from '../lib/format'
import { go } from '../lib/router'
import { ErrorNote, Group, Hidden, Loading, Numbers, Page, RunStatusBadge } from '../ui/common'
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsList, TabsTrigger } from '../ui/nx'

const FLOW_ICON: Record<string, ReactNode> = {
  hunt: <MagnifyingGlassIcon size={14} />,
  apply: <PaperPlaneTiltIcon size={14} />,
  check: <ListChecksIcon size={14} />,
  connect: <UserPlusIcon size={14} />,
  referral: <ChatCircleIcon size={14} />,
  email: <EnvelopeIcon size={14} />,
}

const STEP: Record<RunEvent['kind'], ReactNode> = {
  good: <CheckCircleIcon size={14} className="nx:text-success-subtle-foreground" />,
  warn: <WarningIcon size={14} className="nx:text-warning-subtle-foreground" />,
  error: <XCircleIcon size={14} className="nx:text-error-subtle-foreground" />,
  step: <DotOutlineIcon size={14} className="nx:text-muted-foreground" />,
  tool: <DotOutlineIcon size={14} className="nx:text-muted-foreground" />,
  claude: <DotOutlineIcon size={14} className="nx:text-muted-foreground" />,
}

/** One past run: what it did and what it came to. */
function RunPage({ id }: { id: number }): JSX.Element {
  const detail = useData(() => api.runs.get(id), [id], ['runs'])
  const crumbs = [{ label: 'Run history', to: '/runs' }]
  if (detail.error) return <Page title={`Run ${id}`} crumbs={crumbs}><ErrorNote text={detail.error} /></Page>
  if (!detail.data) return <Page title={`Run ${id}`} crumbs={crumbs}><Loading /></Page>
  const { summary, events } = detail.data
  const steps = events.filter(event => event.kind !== 'claude' && event.kind !== 'tool')
  return (
    <Page
      title={summary.title}
      crumbs={crumbs}
      badge={<RunStatusBadge status={summary.status} />}
      meta={`Run ${summary.id}`}
      narrow
      actions={
        <>
          {summary.flow === 'email' && (
            <Button size="sm" onClick={() => go(`/email/${summary.id}`)}>
              See what changed
            </Button>
          )}
          {summary.opportunityId && (
            <Button variant="outline" size="sm" onClick={() => go(`/opportunity/${summary.opportunityId}`)}>
              Open job
            </Button>
          )}
        </>
      }
    >
      {summary.result && <span className="nx:typography-body-default">{summary.result}</span>}
      <Numbers
        items={[
          when(summary.started),
          ...(summary.usage.ms ? [duration(summary.usage.ms)] : []),
          `${summary.usage.turns} turns`,
          ...(summary.usage.inputTokens ? [`${tokens(summary.usage.inputTokens)} tokens`] : []),
        ]}
      />
      <Group title="Steps">
        {(steps.length ? steps : events).length === 0 ? (
          <span className="nx:typography-body-small nx:text-muted-foreground">Nothing was recorded.</span>
        ) : (
          <ol className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col">
            {(steps.length ? steps : events).map(event => (
              <li key={event.id} className="nx:flex nx:items-center nx:gap-2 nx:min-h-7">
                <span className="nx:inline-flex nx:shrink-0">{STEP[event.kind]}</span>
                <span className="nx:typography-body-small nx:flex-1 nx:min-w-0">{event.text}</span>
                <span className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">{new Date(event.at).toTimeString().slice(0, 5)}</span>
              </li>
            ))}
          </ol>
        )}
      </Group>
    </Page>
  )
}

/** Every run: what it was, what it came to, how long it took. */
export function Runs({ selected }: { selected: number | null }): JSX.Element {
  const [query, setQuery] = useState<RunQuery>({ flow: 'all', portal: 'all', page: 0 })
  const page = useData(() => api.runs.page(query), [JSON.stringify(query)], ['runs'])

  if (selected) return <RunPage id={selected} />
  const data = page.data

  return (
    <Page title="Run history" meta={data ? `${data.total} runs` : undefined} layout="list">
      <div className="nx:flex nx:items-center nx:px-4 nx:py-2 nx:border-b-default nx:border-border-default">
        <Tabs value={query.flow} onValueChange={flow => setQuery({ flow, portal: 'all', page: 0 })}>
          <TabsList variant="underline" size="sm">
            <TabsTrigger value="all">All</TabsTrigger>
            {FLOWS.map(flow => (
              <TabsTrigger key={flow} value={flow}>
                {FLOW_NAMES[flow]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="nx:px-2">
        {page.error && <ErrorNote text={page.error} />}
        {!data ? (
          <div className="nx:p-4">
            <Loading />
          </div>
        ) : data.rows.length === 0 ? (
          <span className="nx:block nx:p-6 nx:typography-body-small nx:text-muted-foreground">No runs yet.</span>
        ) : (
          <>
            <Table aria-label="Runs" density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>
                    <Hidden>Status</Hidden>
                  </TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="nx:text-end">Took</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map(run => (
                  <TableRow key={run.id} className="nx:cursor-pointer" onClick={() => go(`/runs/${run.id}`)}>
                    <TableCell>
                      <span className="nx:flex nx:items-center nx:gap-2">
                        <span className="nx:inline-flex nx:text-muted-foreground">{FLOW_ICON[run.flow]}</span>
                        <span className="nx:typography-label-default nx:whitespace-nowrap">{run.title}</span>
                      </span>
                    </TableCell>
                    <TableCell className="nx:typography-body-small">
                      <span className="nx:line-clamp-1">{run.result ?? ''}</span>
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{when(run.started)}</TableCell>
                    <TableCell className="nx:text-end nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">{run.usage.ms ? duration(run.usage.ms) : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.pages > 1 && (
              <div className="nx:flex nx:items-center nx:justify-end nx:gap-1 nx:px-2 nx:py-3">
                <span className="nx:typography-body-small nx:text-muted-foreground nx:mr-2">
                  {data.page + 1} of {data.pages}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={data.page === 0} onClick={() => setQuery(current => ({ ...current, page: current.page - 1 }))}>
                  <CaretLeftIcon />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={data.page >= data.pages - 1} onClick={() => setQuery(current => ({ ...current, page: current.page + 1 }))}>
                  <CaretRightIcon />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  )
}
