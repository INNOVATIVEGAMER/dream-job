import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowUUpLeftIcon, CaretLeftIcon, CaretRightIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'

import { DISCARD_REASON_NAMES, DISCARD_REASONS } from '../../../shared/types'
import type { DiscardedQuery } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { day, portalName } from '../lib/format'
import { go } from '../lib/router'
import { attempt, ErrorNote, Hidden, Loading, Page } from '../ui/common'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui/nx'

function DiscardedPostings(): JSX.Element {
  const [query, setQuery] = useState<DiscardedQuery>({ reason: 'all', search: '', page: 0 })
  const [search, setSearch] = useState('')
  const page = useData(() => api.discarded.page(query), [JSON.stringify(query)], ['discarded'])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(current => (current.search === search ? current : { ...current, search, page: 0 })), 250)
    return () => clearTimeout(timer)
  }, [search])

  const data = page.data
  const restore = async (postingId: number): Promise<void> => {
    const rowId = await attempt(() => api.discarded.restore(postingId), 'Moved to the tracker')
    if (rowId) go(`/opportunity/${rowId}`)
  }

  return (
    <div className="nx:flex nx:flex-col nx:gap-4 nx:pt-4">
      <div className="nx:flex nx:flex-wrap nx:gap-2 nx:items-center">
        <div className="nx:min-w-0" style={{ flex: '1 1 240px' }}>
          <Input type="search" aria-label="Search discarded postings" placeholder="Search company or role" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <NativeSelect aria-label="Reason" value={query.reason} onChange={event => setQuery(current => ({ ...current, reason: event.target.value, page: 0 }))}>
          <NativeSelectOption value="all">All reasons</NativeSelectOption>
          {DISCARD_REASONS.map(reason => (
            <NativeSelectOption key={reason} value={reason}>
              {DISCARD_REASON_NAMES[reason]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {page.error && <ErrorNote text={page.error} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          <Table aria-label="Discarded postings" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Company and role</TableHead>
                <TableHead>The line that ruled it out</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>
                  <Hidden>Actions</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(posting => (
                <TableRow key={posting.id}>
                  <TableCell>
                    <div className="nx:flex nx:flex-col">
                      <span className="nx:typography-label-default">{posting.company}</span>
                      <span className="nx:typography-body-small nx:text-muted-foreground">
                        {posting.role}, {portalName(posting.portal)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <q className="nx:typography-body-small">{posting.line}</q>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" fill="light" isCaps={false}>
                      {DISCARD_REASON_NAMES[posting.reason]}
                    </Badge>
                  </TableCell>
                  <TableCell className="nx:tabular-nums">{day(posting.at)}</TableCell>
                  <TableCell className="nx:text-end">
                    <Button variant="ghost" size="sm" startIcon={<ArrowUUpLeftIcon />} onClick={() => void restore(posting.id)}>
                      Move to tracker
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="nx:text-muted-foreground">
                    Nothing discarded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-2">
            <span className="nx:typography-body-small nx:text-muted-foreground">
              {data.total} postings, page {data.page + 1} of {data.pages}
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
        </>
      )}
    </div>
  )
}

function NeverShow(): JSX.Element {
  const list = useData(() => api.discarded.neverShow(), [], ['discarded'])
  const [company, setCompany] = useState('')
  const [why, setWhy] = useState('')

  const add = async (): Promise<void> => {
    const done = await attempt(async () => {
      await api.discarded.addNeverShow(company, why)
      return true
    }, `${company.trim()} will never come back`)
    if (done) {
      setCompany('')
      setWhy('')
    }
  }

  return (
    <div className="nx:flex nx:flex-col nx:gap-4 nx:pt-4">
      <p className="nx:typography-body-default nx:m-0 nx:text-muted-foreground">
        A company here never comes back in a hunt, whatever it posts. For a company that's no fit at all. A company that turned down an application doesn't belong here; it stays eligible.
      </p>
      <Card>
        <CardContent>
          <div className="nx:flex nx:flex-wrap nx:gap-3 nx:items-end">
            <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
              <Field>
                <FieldLabel htmlFor="never-company">Company</FieldLabel>
                <Input id="never-company" placeholder="Company name" value={company} onChange={event => setCompany(event.target.value)} />
              </Field>
            </div>
            <div className="nx:min-w-0" style={{ flex: '2 1 280px' }}>
              <Field>
                <FieldLabel htmlFor="never-why">Why</FieldLabel>
                <Input id="never-why" placeholder="For example: gig work, paid hourly" value={why} onChange={event => setWhy(event.target.value)} />
              </Field>
            </div>
            <Button variant="secondary" startIcon={<PlusIcon />} disabled={!company.trim() || !why.trim()} onClick={() => void add()}>
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
      {!list.data ? (
        <Loading />
      ) : (
        <Table aria-label="Companies never shown" density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Why</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>
                <Hidden>Actions</Hidden>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.map(entry => (
              <TableRow key={entry.id}>
                <TableCell>
                  <span className="nx:typography-label-default">{entry.company}</span>
                </TableCell>
                <TableCell>{entry.why}</TableCell>
                <TableCell className="nx:tabular-nums">{day(entry.added)}</TableCell>
                <TableCell className="nx:text-end">
                  <Button variant="ghost" size="sm" startIcon={<TrashIcon />} onClick={() => void attempt(() => api.discarded.removeNeverShow(entry.id), 'Removed')}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {list.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="nx:text-muted-foreground">
                  No companies yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

/** What the hunt ruled out and why, and the companies it never shows. */
export function Discarded({ tab }: { tab: 'discarded' | 'never' }): JSX.Element {
  const never = useData(() => api.discarded.neverShow(), [], ['discarded'])
  const count = useData(() => api.discarded.page({ reason: 'all', search: '', page: 0 }), [], ['discarded'])
  return (
    <Page title="Discarded" description="What the hunt ruled out and why, and the companies it never shows. A discarded posting leaves its company eligible for other roles.">
      <Tabs value={tab} onValueChange={value => go(value === 'never' ? '/discarded/never' : '/discarded')}>
        <TabsList variant="underline">
          <TabsTrigger value="discarded">Discarded postings ({count.data?.total ?? 0})</TabsTrigger>
          <TabsTrigger value="never">Never show again ({never.data?.length ?? 0})</TabsTrigger>
        </TabsList>
        <TabsContent value="discarded">
          <DiscardedPostings />
        </TabsContent>
        <TabsContent value="never">
          <NeverShow />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
