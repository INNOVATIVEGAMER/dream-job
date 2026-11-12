import type { JSX } from 'react'

import { BrowserIcon, CheckCircleIcon, InfoIcon, StopIcon, WarningIcon } from '@phosphor-icons/react'

import type { RunState } from '../../../../shared/types'
import { api } from '../../lib/api'
import { duration, portalName, time, tokens } from '../../lib/format'
import { go } from '../../lib/router'
import { useAppStatus } from '../../lib/status'
import { Activity, attempt, Columns, Page, RunStatusBadge, StatTile, Tiles } from '../../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Card,
  CardContent,
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
}

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

/** The run going now, or the last one: its card when it waits for you, its activity, and what it used. */
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
  const counts = Object.entries(run.counts).filter(([, n]) => n > 0)

  return (
    <Page
      meta={`Run ${run.id}${run.portal ? `, ${portalName(run.portal)}` : ''}, started ${time(run.started)}`}
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
              Stop run
            </Button>
          )}
          {run.opportunityId && !isBusy && (
            <Button variant="outline" onClick={() => go(`/opportunity/${run.opportunityId}`)}>
              Open the row
            </Button>
          )}
        </>
      }
    >
      {run.progress && isBusy && (
        <div className="nx:flex nx:flex-col nx:gap-2">
          <div className="nx:flex nx:justify-between nx:gap-2">
            <span className="nx:typography-label-default">{run.progress.label}</span>
            <span className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">
              {run.progress.done} of {run.progress.total}
            </span>
          </div>
          <Progress aria-label={run.progress.label} value={run.progress.total ? Math.round((run.progress.done / run.progress.total) * 100) : 0} />
        </div>
      )}
      {counts.length > 0 && (
        <Tiles>
          {counts.map(([key, n]) => (
            <StatTile key={key} value={n} label={COUNT_LABELS[key] ?? key} />
          ))}
        </Tiles>
      )}
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
            <Card>
              <CardHeader>
                <CardTitle>{isBusy ? 'Usage so far' : 'Usage'}</CardTitle>
              </CardHeader>
              <CardContent>
                <DescriptionList>
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
          </>
        }
      />
    </Page>
  )
}
