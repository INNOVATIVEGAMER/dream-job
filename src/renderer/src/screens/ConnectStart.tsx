import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { UserPlusIcon } from '@phosphor-icons/react'

import { AT_ONCE } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { day } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Loading, Page, Tip } from '../ui/common'
import { Segments } from '../ui/fields'
import { Checkbox, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSelectionCell, TableSelectionHead } from '../ui/nx'

const SAME = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Starts connection requests: which companies you applied to, and how many people at each. */
export function ConnectStart({ company }: { company?: string }): JSX.Element {
  const status = useAppStatus()
  const applied = useData(() => api.contacts.applied(), [], ['contacts', 'opportunities'])
  const [picked, setPicked] = useState<string[]>([])
  const [perCompany, setPerCompany] = useState('10')
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  // Opened from a company: that one. Otherwise, the companies with no requests yet.
  useEffect(() => {
    if (!applied.data) return
    setPicked(company ? applied.data.filter(one => SAME(one.company, company)).map(one => one.company) : applied.data.filter(one => one.total === 0).map(one => one.company))
  }, [applied.data, company])

  const start = async (): Promise<void> => {
    if (await attempt(() => api.flows.connect({ companies: picked, perCompany: Number(perCompany) }))) go('/run')
  }

  const list = applied.data ?? []
  const all = list.length > 0 && picked.length === list.length
  return (
    <Page title="Send connection requests" crumbs={[{ label: 'Contacts', to: '/contacts' }]} narrow>
      {!applied.data ? (
        <Loading />
      ) : (
        <>
          <div className="nx:flex nx:flex-col nx:gap-2">
            <div className="nx:flex nx:items-center nx:gap-1">
              <span className="nx:typography-label-default">Companies</span>
              <Tip text="Companies you applied to. Requests go out blank, with no note." />
            </div>
            {list.length === 0 ? (
              <span className="nx:typography-body-small nx:text-muted-foreground">Apply somewhere first: requests point at an application.</span>
            ) : (
              <Table aria-label="Companies you applied to" density="compact">
                <TableHeader>
                  <TableRow>
                    <TableSelectionHead>
                      <Checkbox aria-label="Pick every company" checked={all ? true : picked.length ? 'indeterminate' : false} onCheckedChange={on => setPicked(on === true ? list.map(one => one.company) : [])} />
                    </TableSelectionHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Applied for</TableHead>
                    <TableHead className="nx:text-end">Already sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map(one => {
                    const on = picked.includes(one.company)
                    return (
                      <TableRow key={one.company} data-state={on ? 'selected' : undefined}>
                        <TableSelectionCell>
                          <Checkbox
                            aria-label={`Send to ${one.company}`}
                            checked={on}
                            onCheckedChange={value => setPicked(current => (value === true ? [...current, one.company] : current.filter(name => name !== one.company)))}
                          />
                        </TableSelectionCell>
                        <TableCell className="nx:typography-label-default">{one.company}</TableCell>
                        <TableCell className="nx:typography-body-small nx:text-muted-foreground">
                          {one.role} · {day(one.appliedOn)}
                        </TableCell>
                        <TableCell className="nx:text-end nx:typography-body-small nx:tabular-nums">{one.total || '–'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
          <div className="nx:flex nx:flex-col nx:gap-2">
            <div className="nx:flex nx:items-center nx:gap-1">
              <span className="nx:typography-label-default">People per company</span>
              <Tip text="Engineers in your field first, then their managers and the hiring team." />
            </div>
            <div>
              <Segments value={perCompany} ariaLabel="People per company" options={['5', '10', '15'].map(n => ({ value: n, label: n }))} onChange={setPerCompany} />
            </div>
          </div>
          <div className="nx:flex nx:items-center nx:gap-3">
            <Button startIcon={<UserPlusIcon />} disabled={isBusy || picked.length === 0} onClick={() => void start()}>
              Send to {picked.length} {picked.length === 1 ? 'company' : 'companies'}
            </Button>
            <span className="nx:typography-body-small nx:text-muted-foreground">{picked.length > 1 ? `${Math.min(AT_ONCE, picked.length)} at a time, one session each` : isBusy ? 'Another run is going.' : ''}</span>
          </div>
        </>
      )}
    </Page>
  )
}
