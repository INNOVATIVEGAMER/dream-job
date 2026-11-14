import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { PlusIcon } from '@phosphor-icons/react'

import { api } from '../lib/api'
import { useData } from '../lib/data'
import { day, plural } from '../lib/format'
import { go } from '../lib/router'
import { attempt, ErrorNote, Hidden, Loading, Page } from '../ui/common'
import { NamePicker } from '../ui/fields'
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

const HOVER = 'nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity'

/** Companies hunts never show: every job there is skipped, and the company stays in the tracker. */
export function NeverShow(): JSX.Element {
  const list = useData(() => api.companies.neverShown(), [], ['jobs'])
  const [adding, setAdding] = useState(false)
  const [company, setCompany] = useState('')
  const [why, setWhy] = useState('')
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    if (!adding) return
    setCompany('')
    setWhy('')
    void api.companies.names().then(rows => setNames(rows.map(row => row.name))).catch(() => undefined)
  }, [adding])

  const add = async (): Promise<void> => {
    const name = company.trim()
    await attempt(() => api.companies.addNeverShow(name, why.trim() || 'You asked'), `${name} won't show in hunts`)
    setAdding(false)
    list.reload()
  }
  const showAgain = async (id: number, name: string): Promise<void> => {
    await attempt(() => api.companies.setNeverShow(id, false), `${name} shows in hunts again`)
    list.reload()
  }

  return (
    <Page
      title="Never show"
      meta={list.data ? plural(list.data.length, 'company', 'companies') : undefined}
      layout="list"
      actions={
        <Button variant="outline" size="sm" startIcon={<PlusIcon />} onClick={() => setAdding(true)}>
          Add company
        </Button>
      }
    >
      <div className="nx:px-2 nx:pt-2">
        {list.error && <ErrorNote text={list.error} />}
        {!list.data ? (
          <div className="nx:p-4">
            <Loading />
          </div>
        ) : list.data.length === 0 ? (
          <div className="nx:p-8">
            <EmptyState>
              <EmptyStateHeader>
                <EmptyStateTitle>No company is hidden</EmptyStateTitle>
                <EmptyStateDescription>Hunts skip every job at a company here. The company stays in your tracker.</EmptyStateDescription>
              </EmptyStateHeader>
            </EmptyState>
          </div>
        ) : (
          <Table aria-label="Companies hunts never show" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>
                  <Hidden>Actions</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map(entry => (
                <TableRow key={entry.id} className="nx:group">
                  <TableCell>
                    <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground" onClick={() => go(`/company/${entry.id}`)}>
                      {entry.company}
                    </button>
                  </TableCell>
                  <TableCell className="nx:typography-body-small">{entry.why}</TableCell>
                  <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">{day(entry.added)}</TableCell>
                  <TableCell className="nx:text-end">
                    <div className={HOVER}>
                      <Button variant="outline" size="sm" onClick={() => void showAgain(entry.id, entry.company)}>
                        Show again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Never show a company</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="never-company">Company</FieldLabel>
                <NamePicker id="never-company" value={company} names={names} onChange={setCompany} placeholder="Find or add a company" />
              </Field>
              <Field>
                <FieldLabel htmlFor="never-why">Why</FieldLabel>
                <Input id="never-why" placeholder="AI-training gig work, not engineering" value={why} onChange={event => setWhy(event.target.value)} />
              </Field>
            </FieldGroup>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button disabled={!company.trim()} onClick={() => void add()}>
              Never show
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
