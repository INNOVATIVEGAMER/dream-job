import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowSquareOutIcon, ArrowsClockwiseIcon, CaretDownIcon, CaretRightIcon, ChatCircleIcon, CopyIcon, MagnifyingGlassIcon, PencilSimpleIcon, UserPlusIcon } from '@phosphor-icons/react'

import { CONTACT_VIEWS } from '../../../shared/types'
import type { Contact, ContactCompany, ContactView } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { day } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, ErrorNote, Hidden, Loading, Page, StatusBadge } from '../ui/common'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '../ui/nx'

const HOVER = 'nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity'
const VIEW_NAMES: Record<ContactView, string> = { ready: 'Ready', pending: 'Pending', accepted: 'Accepted', messaged: 'Messaged', referred: 'Referred', all: 'All' }

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join('')

function summaryOf(company: ContactCompany): string {
  const parts = (['referred', 'accepted', 'messaged', 'pending'] as const).filter(state => company.counts[state] > 0).map(state => `${company.counts[state]} ${state}`)
  return parts.slice(0, 2).join(' · ')
}

/** A thank-you to someone who referred the user: drafted here, sent by the user. */
function ThanksSheet({ person, onClose }: { person: Contact | null; onClose: () => void }): JSX.Element {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!person) return
    const first = person.name.split(' ')[0] ?? person.name
    setText(`Hi ${first}, thank you for referring me at ${person.company}. I really appreciate you taking the time.`)
  }, [person?.id])

  return (
    <Sheet open={!!person} onOpenChange={on => !on && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Thank {person?.name}</SheetTitle>
          <SheetDescription>Referred you at {person?.company}.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <Field>
            <FieldLabel htmlFor="thanks-body">Draft</FieldLabel>
            <Textarea id="thanks-body" rows={5} value={text} onChange={event => setText(event.target.value)} />
          </Field>
          <span className="nx:typography-body-small nx:text-muted-foreground">You send it. The app never does.</span>
        </SheetBody>
        <SheetFooter>
          <div className="nx:flex nx:flex-wrap nx:gap-2">
            <Button
              startIcon={<CopyIcon />}
              onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('Copied'), () => toast.error('Could not copy. Select the text and copy it.'))}
            >
              Copy
            </Button>
            {person && (
              <Button variant="outline" endIcon={<ArrowSquareOutIcon />} onClick={() => void attempt(() => api.chrome.openUrl(person.profileUrl))}>
                Open in LinkedIn
              </Button>
            )}
            {person && (
              <Button variant="ghost" onClick={() => void attempt(() => api.contacts.markThanked(person.id), 'Marked as thanked').then(onClose)}>
                Mark as thanked
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** Contacts, company first: each company you applied to with the people there and where each stands. */
export function Contacts({ thanksId = null }: { thanksId?: number | null }): JSX.Element {
  const status = useAppStatus()
  const [view, setView] = useState<ContactView>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [shut, setShut] = useState<Set<number>>(new Set())
  const list = useData(() => api.contacts.byCompany(view, query), [view, query], ['contacts', 'opportunities'])
  const thanking = useData(() => (thanksId ? api.contacts.get(thanksId) : Promise.resolve(null)), [thanksId], ['contacts'])
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200)
    return () => clearTimeout(timer)
  }, [search])

  const data = list.data
  // Ready companies and searches open by themselves; the caret overrides either way.
  const isOpen = (company: ContactCompany): boolean => open.has(company.id) || ((company.isReady || !!query) && !shut.has(company.id))
  const toggle = (company: ContactCompany): void => {
    const was = isOpen(company)
    setOpen(current => {
      const next = new Set(current)
      if (was) next.delete(company.id)
      else next.add(company.id)
      return next
    })
    setShut(current => {
      const next = new Set(current)
      if (was) next.add(company.id)
      else next.delete(company.id)
      return next
    })
  }

  const checkAccepted = async (): Promise<void> => {
    if (await attempt(() => api.flows.checkAccepted())) go('/run')
  }

  return (
    <Page
      title="Contacts"
      meta={data ? `${data.people} people at ${data.companyCount} companies` : undefined}
      layout="list"
      actions={
        <>
          <Button variant="ghost" size="sm" startIcon={<ArrowsClockwiseIcon />} disabled={isBusy || !data?.counts.pending} onClick={() => void checkAccepted()}>
            Check who accepted
          </Button>
          <Button variant="outline" size="sm" startIcon={<UserPlusIcon />} onClick={() => go('/contacts/connect')}>
            Send requests
          </Button>
          <Button size="sm" startIcon={<ChatCircleIcon />} onClick={() => go('/contacts/message')}>
            Message accepted
          </Button>
        </>
      }
    >
      <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-3 nx:px-4 nx:py-2 nx:border-b-default nx:border-border-default">
        <Tabs value={view} onValueChange={next => setView(next as ContactView)}>
          <TabsList variant="underline" size="sm">
            {CONTACT_VIEWS.map(one => (
              <TabsTrigger key={one} value={one}>
                {VIEW_NAMES[one]}
                <span className="nx:ml-1 nx:text-muted-foreground">{data?.counts[one] ?? ''}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="nx:w-60">
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <MagnifyingGlassIcon />
            </InputGroupAddon>
            <InputGroupInput type="search" aria-label="Search people and companies" placeholder="Search people and companies" value={search} onChange={event => setSearch(event.target.value)} />
          </InputGroup>
        </div>
      </div>

      <div className="nx:px-2 nx:pb-12">
        {list.error && <ErrorNote text={list.error} />}
        {!data ? (
          <div className="nx:p-4">
            <Loading />
          </div>
        ) : data.companies.length === 0 ? (
          <div className="nx:p-8">
            <EmptyState>
              <EmptyStateHeader>
                <EmptyStateTitle>{query ? 'Nothing matches' : view === 'ready' ? 'No company is ready yet' : 'No one here yet'}</EmptyStateTitle>
                <EmptyStateDescription>{view === 'ready' ? 'A company is ready once 3 accept, or nobody there is still pending.' : 'Connection requests add people here.'}</EmptyStateDescription>
              </EmptyStateHeader>
            </EmptyState>
          </div>
        ) : (
          <Table aria-label="People by company" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Applied for</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <Hidden>Actions</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.companies.map(company => {
                const expanded = isOpen(company)
                return [
                  <TableRow key={`c-${company.id}`} className="nx:group">
                    <TableCell>
                      <div className="nx:flex nx:items-center nx:gap-1 nx:min-w-0">
                        <Button variant="ghost" size="icon-sm" aria-label={expanded ? `Hide people at ${company.name}` : `Show people at ${company.name}`} onClick={() => toggle(company)}>
                          {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
                        </Button>
                        <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground nx:whitespace-nowrap" onClick={() => go(`/company/${company.id}`)}>
                          {company.name}
                        </button>
                        <span className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">
                          {company.people.length} {company.people.length === 1 ? 'person' : 'people'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="nx:typography-body-small nx:text-muted-foreground">
                      {company.jobId ? (
                        <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:text-muted-foreground nx:typography-body-small nx:text-left nx:line-clamp-1" onClick={() => go(`/opportunity/${company.jobId}`)}>
                          {company.role}
                        </button>
                      ) : (
                        '–'
                      )}
                    </TableCell>
                    <TableCell className="nx:typography-body-small nx:whitespace-nowrap">{summaryOf(company)}</TableCell>
                    <TableCell>
                      {company.isReady && (
                        <Badge variant="success" fill="light" isCaps={false}>
                          Ready
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="nx:text-end">
                      {company.isReady && (
                        <Button variant="outline" size="sm" startIcon={<ChatCircleIcon />} disabled={isBusy} onClick={() => go(`/contacts/message/${encodeURIComponent(company.name)}`)}>
                          Message {company.counts.accepted}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>,
                  ...(expanded
                    ? company.people.map(person => (
                        <TableRow key={`p-${person.id}`} className="nx:group">
                          <TableCell>
                            <div className="nx:flex nx:items-center nx:gap-2 nx:pl-9 nx:min-w-0">
                              <Avatar size="xs">
                                <AvatarFallback>{initials(person.name)}</AvatarFallback>
                              </Avatar>
                              <span className="nx:typography-label-default nx:whitespace-nowrap">{person.name}</span>
                              <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{person.role}</span>
                            </div>
                          </TableCell>
                          <TableCell />
                          <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">Sent {day(person.sent)}</TableCell>
                          <TableCell>
                            <StatusBadge status={person.state} />
                          </TableCell>
                          <TableCell className="nx:text-end">
                            <div className={`nx:flex nx:items-center nx:justify-end nx:gap-1 ${HOVER}`}>
                              {person.state === 'referred' && !person.thankedAt && (
                                <Button variant="outline" size="sm" startIcon={<PencilSimpleIcon />} onClick={() => go(`/contacts/${person.id}/thanks`)}>
                                  Draft thanks
                                </Button>
                              )}
                              <Button variant="ghost" size="icon-sm" aria-label={`${person.name} on LinkedIn`} onClick={() => void attempt(() => api.chrome.openUrl(person.profileUrl))}>
                                <ArrowSquareOutIcon />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    : []),
                ]
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <ThanksSheet person={thanksId ? (thanking.data ?? null) : null} onClose={() => go('/contacts')} />
    </Page>
  )
}
