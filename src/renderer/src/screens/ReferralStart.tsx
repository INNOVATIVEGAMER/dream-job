import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, ArrowsClockwiseIcon, PaperPlaneTiltIcon, WarningIcon } from '@phosphor-icons/react'

import { AT_ONCE } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Loading, Page, Tip } from '../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Badge,
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectionCell,
  TableSelectionHead,
} from '../ui/nx'

const SAME = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Starts referral messages: which ready companies, and the saved wording that goes out. */
export function ReferralStart({ company }: { company?: string }): JSX.Element {
  const status = useAppStatus()
  const ready = useData(() => api.contacts.ready(), [], ['contacts'])
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const [picked, setPicked] = useState<string[]>([])
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  // Opened from a company: that one. Otherwise, every ready company.
  useEffect(() => {
    if (!ready.data) return
    setPicked(
      company
        ? ready.data.filter(one => SAME(one.company, company) && one.opportunityId).map(one => one.company)
        : ready.data.filter(one => one.isReady && one.opportunityId).map(one => one.company),
    )
  }, [ready.data, company])

  if (!ready.data || !settings.data) return <Page title="Message accepted" crumbs={[{ label: 'Contacts', to: '/contacts' }]}><Loading /></Page>

  const template = settings.data.referral.template.trim()
  const list = ready.data.filter(one => one.opportunityId)
  const people = list.filter(one => picked.includes(one.company)).reduce((sum, one) => sum + one.accepted, 0)
  const send = async (): Promise<void> => {
    if (await attempt(() => api.flows.referral({ companies: picked }))) go('/run')
  }
  const check = async (): Promise<void> => {
    if (await attempt(() => api.flows.checkAccepted())) go('/run')
  }

  return (
    <Page
      title="Message accepted"
      crumbs={[{ label: 'Contacts', to: '/contacts' }]}
      narrow
      actions={
        <Button variant="ghost" size="sm" startIcon={<ArrowsClockwiseIcon />} disabled={isBusy} onClick={() => void check()}>
          Check who accepted
        </Button>
      }
    >
      {!template && (
        <Alert variant="warning" layout="inline">
          <AlertIcon>
            <WarningIcon />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>Save your referral message first.</AlertDescription>
          </AlertContent>
          <Button variant="outline" size="sm" onClick={() => go('/settings/message')}>
            Open Settings
          </Button>
        </Alert>
      )}
      <div className="nx:flex nx:flex-col nx:gap-2">
        <div className="nx:flex nx:items-center nx:gap-1">
          <span className="nx:typography-label-default">Companies</span>
          <Tip text="Ready: 3 people there accepted, or nobody there is still pending." />
        </div>
        {list.length === 0 ? (
          <span className="nx:typography-body-small nx:text-muted-foreground">Nobody has accepted yet.</span>
        ) : (
          <Table aria-label="Companies with accepted connections" density="compact">
            <TableHeader>
              <TableRow>
                <TableSelectionHead>
                  <Checkbox
                    aria-label="Pick every company"
                    checked={picked.length === list.length ? true : picked.length ? 'indeterminate' : false}
                    onCheckedChange={on => setPicked(on === true ? list.map(one => one.company) : [])}
                  />
                </TableSelectionHead>
                <TableHead>Company</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead>Applied for</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map(one => {
                const on = picked.includes(one.company)
                return (
                  <TableRow key={one.company} data-state={on ? 'selected' : undefined}>
                    <TableSelectionCell>
                      <Checkbox
                        aria-label={`Message ${one.company}`}
                        checked={on}
                        onCheckedChange={value => setPicked(current => (value === true ? [...current, one.company] : current.filter(name => name !== one.company)))}
                      />
                    </TableSelectionCell>
                    <TableCell className="nx:typography-label-default">{one.company}</TableCell>
                    <TableCell className="nx:typography-body-small">
                      <span className="nx:flex nx:items-center nx:gap-2">
                        {one.accepted} accepted
                        {one.isReady ? (
                          <Badge variant="success" fill="light" isCaps={false}>
                            Ready
                          </Badge>
                        ) : (
                          <span className="nx:text-muted-foreground">{one.pending} pending</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="nx:typography-body-small nx:text-muted-foreground">{one.role ?? ''}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
      {template && (
        <div className="nx:flex nx:flex-col nx:gap-2">
          <div className="nx:flex nx:items-center nx:justify-between">
            <div className="nx:flex nx:items-center nx:gap-1">
              <span className="nx:typography-label-default">Your message</span>
              <Tip text={`Sent word for word${settings.data.referral.attachResume ? ', with your resume' : ''}. Only the name, role, company and link change.`} />
            </div>
            <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go('/settings/message')}>
              Edit in Settings
            </Button>
          </div>
          <div className="nx:rounded-md nx:bg-muted nx:p-4 nx:typography-body-small nx:whitespace-pre-wrap">{template}</div>
        </div>
      )}
      <div className="nx:flex nx:items-center nx:gap-3">
        <Button startIcon={<PaperPlaneTiltIcon />} disabled={isBusy || people === 0 || !template} onClick={() => void send()}>
          Send {people} {people === 1 ? 'message' : 'messages'}
        </Button>
        <span className="nx:typography-body-small nx:text-muted-foreground">{picked.length > 1 ? `${Math.min(AT_ONCE, picked.length)} companies at a time` : isBusy ? 'Another run is going.' : ''}</span>
      </div>
    </Page>
  )
}
