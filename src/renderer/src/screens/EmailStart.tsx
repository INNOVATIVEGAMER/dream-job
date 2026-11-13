import { useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, EnvelopeIcon, WarningIcon } from '@phosphor-icons/react'

import { EMAIL_COUNTS } from '../../../shared/types'
import type { EmailCount } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { when } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Group, Hidden, Loading, Page, RunStatusBadge, Tip } from '../ui/common'
import { Segments } from '../ui/fields'
import { Alert, AlertContent, AlertDescription, AlertIcon, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/nx'

/** Update from Gmail, before it starts: how many emails, then the last few checks. */
export function EmailStart(): JSX.Element {
  const status = useAppStatus()
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const checks = useData(() => api.runs.page({ flow: 'email', portal: 'all', page: 0 }), [], ['runs'])
  const [count, setCount] = useState<EmailCount | null>(null)

  const email = settings.data?.email
  const crumbs = [{ label: 'Tracker', to: '/tracker' }]
  if (!email) return <Page title="Update from Gmail" crumbs={crumbs}><Loading /></Page>

  const chosen = count ?? email.count
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const google = sites.data?.find(site => site.site === 'google')?.state
  const problem = !email.enabled ? 'Gmail is off in Settings.' : google === 'signed-out' ? "Google is signed out in the app's Chrome." : null

  const start = async (): Promise<void> => {
    if (await attempt(() => api.flows.email({ count: chosen }))) go('/run')
  }

  return (
    <Page
      title="Update from Gmail"
      crumbs={crumbs}
      narrow
      actions={
        <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go('/settings/portals/gmail')}>
          Gmail settings
        </Button>
      }
    >
      {problem && (
        <Alert variant="warning" layout="inline">
          <AlertIcon>
            <WarningIcon />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>{problem}</AlertDescription>
          </AlertContent>
          <Button variant="outline" size="sm" onClick={() => go(email.enabled ? '/settings/accounts' : '/settings/portals/gmail')}>
            Open Settings
          </Button>
        </Alert>
      )}
      <div className="nx:flex nx:flex-col nx:gap-2">
        <div className="nx:flex nx:items-center nx:gap-1">
          <span className="nx:typography-label-default">Emails to read</span>
          <Tip text="Your newest, from every inbox tab except Promotions. Emails an earlier check read are skipped." />
        </div>
        <div>
          <Segments value={String(chosen)} ariaLabel="Emails to read" options={EMAIL_COUNTS.map(n => ({ value: String(n), label: String(n) }))} onChange={value => setCount(Number(value) as EmailCount)} />
        </div>
      </div>
      <div className="nx:flex nx:items-center nx:gap-3">
        <Button startIcon={<EnvelopeIcon />} disabled={isBusy || !!problem} onClick={() => void start()}>
          Check email
        </Button>
        <span className="nx:typography-body-small nx:text-muted-foreground">{isBusy ? 'Another run is going.' : 'Reads sender and subject; opens only emails about your search'}</span>
      </div>
      <Group title="Recent checks">
        {checks.data && checks.data.rows.length > 0 ? (
          <Table aria-label="Recent checks" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>
                  <Hidden>Status</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.data.rows.slice(0, 5).map(run => (
                <TableRow key={run.id} className="nx:cursor-pointer" onClick={() => go(`/email/${run.id}`)}>
                  <TableCell className="nx:typography-label-default nx:whitespace-nowrap">{when(run.started)}</TableCell>
                  <TableCell className="nx:typography-body-small">{run.result ?? ''}</TableCell>
                  <TableCell className="nx:text-end">
                    <RunStatusBadge status={run.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <span className="nx:typography-body-small nx:text-muted-foreground">No checks yet.</span>
        )}
      </Group>
    </Page>
  )
}
