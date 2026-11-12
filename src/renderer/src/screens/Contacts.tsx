import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import {
  ArrowSquareOutIcon,
  BuildingsIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  UserCheckIcon,
  UserPlusIcon,
} from '@phosphor-icons/react'

import { CONTACT_STATES } from '../../../shared/types'
import type { ContactQuery, ContactState } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { capitalize, day } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, ErrorNote, Hidden, Loading, Page, StatTile, Tiles } from '../ui/common'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

const STATE_BADGE: Record<ContactState, { variant: 'information' | 'success' | 'default' | 'secondary'; icon: JSX.Element }> = {
  pending: { variant: 'secondary', icon: <ClockIcon /> },
  accepted: { variant: 'information', icon: <UserCheckIcon /> },
  messaged: { variant: 'default', icon: <PaperPlaneTiltIcon /> },
  referred: { variant: 'success', icon: <CheckCircleIcon /> },
}

/** Everyone a connection request went to, where each stands, and the companies ready for the referral message. */
export function Contacts(): JSX.Element {
  const status = useAppStatus()
  const [query, setQuery] = useState<ContactQuery>({ state: 'all', company: 'all', search: '', page: 0 })
  const [search, setSearch] = useState('')
  const page = useData(() => api.contacts.page(query), [JSON.stringify(query)], ['contacts'])
  const ready = useData(() => api.contacts.ready(), [], ['contacts'])
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  useEffect(() => {
    const timer = setTimeout(() => setQuery(current => (current.search === search ? current : { ...current, search, page: 0 })), 250)
    return () => clearTimeout(timer)
  }, [search])

  const set = (patch: Partial<ContactQuery>): void => setQuery(current => ({ ...current, ...patch, page: patch.page ?? 0 }))
  const data = page.data
  const total = data ? Object.values(data.counts).reduce((sum, n) => sum + n, 0) : 0

  return (
    <Page
      title="Contacts"
      description="Everyone a connection request went to, and where each one stands. Requests go out blank, with no note."
      actions={
        <>
          <Button variant="outline" startIcon={<UserPlusIcon />} disabled={isBusy} onClick={() => go('/contacts/connect')}>
            Send connection requests
          </Button>
          <Button startIcon={<PaperPlaneTiltIcon />} disabled={isBusy} onClick={() => go('/contacts/message')}>
            Message accepted
          </Button>
        </>
      }
    >
      {page.error && <ErrorNote text={page.error} />}
      {data && (
        <Tiles>
          <StatTile value={data.counts.pending} label="Pending" onClick={() => set({ state: 'pending' })} />
          <StatTile value={data.counts.accepted} label="Accepted, not yet messaged" onClick={() => set({ state: 'accepted' })} />
          <StatTile value={data.counts.messaged} label="Messaged" onClick={() => set({ state: 'messaged' })} />
          <StatTile value={data.counts.referred} label="Referred you" onClick={() => set({ state: 'referred' })} />
        </Tiles>
      )}

      {ready.data && ready.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ready for your message</CardTitle>
            <CardDescription>Companies with accepted connections. Each gets your approved message, word for word, with your resume.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              {ready.data.map(company => (
                <Item key={company.company} size="sm">
                  <ItemMedia variant="icon">
                    <BuildingsIcon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{company.company}</ItemTitle>
                    <ItemDescription>
                      {company.accepted} accepted{company.pending ? `, ${company.pending} pending` : ''}.{' '}
                      {company.role ? `Applied ${day(company.appliedOn)} to ${company.role}.` : 'No applied role to point the message at yet.'}
                      {!company.isReady && ' Waits for a bigger batch.'}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant={company.isReady ? 'secondary' : 'ghost'} size="sm" disabled={isBusy} onClick={() => go('/contacts/message')}>
                      {company.isReady ? `Send ${company.accepted} ${company.accepted === 1 ? 'message' : 'messages'}` : 'Send now anyway'}
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      )}

      <div className="nx:flex nx:flex-wrap nx:gap-2 nx:items-center">
        <div className="nx:min-w-0" style={{ flex: '1 1 240px' }}>
          <Input type="search" aria-label="Search people" placeholder="Search name or company" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <NativeSelect aria-label="State" value={query.state} onChange={event => set({ state: event.target.value })}>
          <NativeSelectOption value="all">All states ({total})</NativeSelectOption>
          {CONTACT_STATES.map(state => (
            <NativeSelectOption key={state} value={state}>
              {state === 'referred' ? 'Referred you' : capitalize(state)} ({data?.counts[state] ?? 0})
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Company" value={query.company} onChange={event => set({ company: event.target.value })}>
          <NativeSelectOption value="all">All companies</NativeSelectOption>
          {data?.companies.map(company => (
            <NativeSelectOption key={company} value={company}>
              {company}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {!data ? (
        <Loading />
      ) : (
        <>
          <Table aria-label="Contacts" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Request sent</TableHead>
                <TableHead>State</TableHead>
                <TableHead>
                  <Hidden>Actions</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(contact => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <div className="nx:flex nx:flex-col">
                      <span className="nx:typography-label-default">{contact.name}</span>
                      <span className="nx:typography-body-small nx:text-muted-foreground">{contact.role}</span>
                    </div>
                  </TableCell>
                  <TableCell>{contact.company}</TableCell>
                  <TableCell className="nx:tabular-nums">{day(contact.sent)}</TableCell>
                  <TableCell>
                    <Badge variant={STATE_BADGE[contact.state].variant} fill="light" isCaps={false} leftIcon={STATE_BADGE[contact.state].icon}>
                      {contact.state === 'referred'
                        ? `Referred you, ${day(contact.referredAt)}`
                        : contact.state === 'messaged'
                          ? `Messaged ${day(contact.messagedAt)}`
                          : capitalize(contact.state)}
                    </Badge>
                  </TableCell>
                  <TableCell className="nx:text-end">
                    {contact.state === 'referred' ? (
                      <Button variant="outline" size="sm" startIcon={<PencilSimpleIcon />} onClick={() => go(`/contacts/${contact.id}/thanks`)}>
                        Draft thanks
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" endIcon={<ArrowSquareOutIcon />} onClick={() => void attempt(() => api.chrome.openUrl(contact.profileUrl))}>
                        Profile
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="nx:text-muted-foreground">
                    No one here yet. Send connection requests to people at companies you applied to.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-2">
            <span className="nx:typography-body-small nx:text-muted-foreground">
              Page {data.page + 1} of {data.pages}. Only your approved message goes out on its own; anything else, such as a thank-you, is drafted for you to send.
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
