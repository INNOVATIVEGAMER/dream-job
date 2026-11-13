import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowCounterClockwiseIcon, CaretLeftIcon, CaretRightIcon, FunnelIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'

import { DISCARD_REASON_NAMES, DISCARD_REASONS } from '../../../shared/types'
import type { DiscardedQuery, DiscardReason } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { day } from '../lib/format'
import { go } from '../lib/router'
import { attempt, ErrorNote, Hidden, Loading, Page } from '../ui/common'
import { NamePicker } from '../ui/fields'
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
  Field,
  FieldGroup,
  FieldLabel,
  FilterChip,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from '../ui/nx'

const HOVER = 'nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity'

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }): JSX.Element | null {
  if (pages <= 1) return null
  return (
    <div className="nx:flex nx:items-center nx:justify-end nx:gap-1 nx:px-2 nx:py-3">
      <span className="nx:typography-body-small nx:text-muted-foreground nx:mr-2">
        {page + 1} of {pages}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <CaretLeftIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        <CaretRightIcon />
      </Button>
    </div>
  )
}

function Postings(): JSX.Element {
  const [query, setQuery] = useState<DiscardedQuery>({ reason: 'all', search: '', page: 0 })
  const [search, setSearch] = useState('')
  const page = useData(() => api.discarded.page(query), [JSON.stringify(query)], ['discarded'])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(current => (current.search === search ? current : { ...current, search, page: 0 })), 200)
    return () => clearTimeout(timer)
  }, [search])

  const restore = async (postingId: number): Promise<void> => {
    const rowId = await attempt(() => api.discarded.restore(postingId), 'Back in the tracker as found')
    if (rowId) go(`/opportunity/${rowId}`)
  }
  const data = page.data
  const reason = query.reason as DiscardReason | 'all'

  return (
    <>
      <div className="nx:flex nx:items-center nx:justify-end nx:gap-2 nx:px-4 nx:py-2">
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
            <DropdownMenuLabel>Reason</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={query.reason} onValueChange={value => setQuery(current => ({ ...current, reason: value, page: 0 }))}>
              <DropdownMenuRadioItem value="all">Any reason</DropdownMenuRadioItem>
              {DISCARD_REASONS.map(one => (
                <DropdownMenuRadioItem key={one} value={one}>
                  {DISCARD_REASON_NAMES[one]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {reason !== 'all' && (
        <div className="nx:flex nx:gap-2 nx:px-4 nx:pb-2">
          <FilterChip name="reason" value={reason} aria-label={`Remove ${DISCARD_REASON_NAMES[reason]}`} onClick={() => setQuery(current => ({ ...current, reason: 'all', page: 0 }))}>
            {`Reason: ${DISCARD_REASON_NAMES[reason]}`}
          </FilterChip>
        </div>
      )}
      <div className="nx:px-2">
        {page.error && <ErrorNote text={page.error} />}
        {!data ? (
          <div className="nx:p-4">
            <Loading />
          </div>
        ) : data.rows.length === 0 ? (
          <div className="nx:p-8">
            <EmptyState>
              <EmptyStateHeader>
                <EmptyStateTitle>Nothing discarded{reason !== 'all' || query.search ? ' matches' : ' yet'}</EmptyStateTitle>
                <EmptyStateDescription>Postings a hunt rules out land here, with the words that ruled them out.</EmptyStateDescription>
              </EmptyStateHeader>
            </EmptyState>
          </div>
        ) : (
          <>
            <Table aria-label="Discarded postings" density="compact">
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
                {data.rows.map(row => (
                  <TableRow key={row.id} className="nx:group">
                    <TableCell>
                      <div className="nx:flex nx:items-center nx:gap-2 nx:min-w-0 nx:max-w-[320px]">
                        <span className="nx:typography-label-default nx:whitespace-nowrap">{row.company}</span>
                        <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{row.role}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <q className="nx:typography-body-small nx:text-muted-foreground nx:line-clamp-2">{row.line}</q>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" fill="light" isCaps={false}>
                        {DISCARD_REASON_NAMES[row.reason]}
                      </Badge>
                    </TableCell>
                    <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">{day(row.at)}</TableCell>
                    <TableCell className="nx:text-end">
                      <div className={HOVER}>
                        <Button variant="outline" size="sm" startIcon={<ArrowCounterClockwiseIcon />} onClick={() => void restore(row.id)}>
                          Restore
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={data.page} pages={data.pages} onPage={next => setQuery(current => ({ ...current, page: next }))} />
          </>
        )}
      </div>
    </>
  )
}

function NeverShow({ adding, setAdding }: { adding: boolean; setAdding: (on: boolean) => void }): JSX.Element {
  const list = useData(() => api.discarded.neverShow(), [], ['discarded'])
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
    await attempt(() => api.discarded.addNeverShow(company, why || 'You asked'), `${company} won't show in hunts`)
    setAdding(false)
  }

  return (
    <div className="nx:px-2">
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
                    <Button variant="outline" size="sm" onClick={() => void attempt(() => api.discarded.removeNeverShow(entry.id), `${entry.company} shows in hunts again`)}>
                      Show again
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
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
    </div>
  )
}

/** Postings hunts ruled out, and companies hunts never show. */
export function Discarded({ tab }: { tab: 'discarded' | 'never' }): JSX.Element {
  const never = useData(() => api.discarded.neverShow(), [], ['discarded'])
  const count = useData(() => api.discarded.page({ reason: 'all', search: '', page: 0 }), [], ['discarded'])
  const [adding, setAdding] = useState(false)
  return (
    <Page
      title="Discarded"
      meta={count.data ? `${count.data.total} postings` : undefined}
      layout="list"
      actions={
        tab === 'never' ? (
          <Button variant="outline" size="sm" startIcon={<PlusIcon />} onClick={() => setAdding(true)}>
            Add company
          </Button>
        ) : undefined
      }
    >
      <div className="nx:flex nx:items-center nx:px-4 nx:py-2 nx:border-b-default nx:border-border-default">
        <Tabs value={tab} onValueChange={value => go(value === 'never' ? '/discarded/never' : '/discarded')}>
          <TabsList variant="underline" size="sm">
            <TabsTrigger value="discarded">
              Postings <span className="nx:ml-1 nx:text-muted-foreground">{count.data?.total ?? ''}</span>
            </TabsTrigger>
            <TabsTrigger value="never">
              Never show <span className="nx:ml-1 nx:text-muted-foreground">{never.data?.length ?? ''}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {tab === 'never' ? <NeverShow adding={adding} setAdding={setAdding} /> : <Postings />}
    </Page>
  )
}
