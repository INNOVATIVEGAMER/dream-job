import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  UserPlusIcon,
} from '@phosphor-icons/react'

import { REQUESTS_PER_COMPANY, VIEW_STATUSES } from '../../../shared/types'
import type { CompanyEvent, Contact } from '../../../shared/types'
import { api } from '../lib/api'
import { useAutosave } from '../lib/autosave'
import { useData } from '../lib/data'
import { capitalize, day, portalName, when } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { sendRequests } from '../ui/CommandMenu'
import { attempt, DetailLayout, ErrorNote, Group, Hidden, Loading, Numbers, Page, Props, StatusBadge, Tip } from '../ui/common'
import { Choice, NamePicker } from '../ui/fields'
import {
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldLabel,
  Input,
  Label,
  Separator,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '../ui/nx'
import { AddJobDialog } from './AddJob'

const STAGES = [
  { value: 'startup', label: 'Startup' },
  { value: 'scaleup', label: 'Scaleup' },
  { value: 'large', label: 'Large' },
]

const HOVER = 'nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity'

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join('')

/** When they connected, or when the request went; someone connected before the app knew them has neither. */
function sinceText(contact: Contact): string {
  if (contact.state === 'accepted') return contact.acceptedAt ? `Connected ${day(contact.acceptedAt)}` : ''
  return contact.sent ? `Sent ${day(contact.sent)}` : ''
}

/** One person at the company: where they stand, since when, and their LinkedIn. */
function Person({ contact }: { contact: Contact }): JSX.Element {
  return (
    <div className="nx:group nx:flex nx:items-center nx:gap-2 nx:min-h-9">
      <Avatar size="xs">
        <AvatarFallback>{initials(contact.name)}</AvatarFallback>
      </Avatar>
      <span className="nx:typography-label-default nx:whitespace-nowrap">{contact.name}</span>
      <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate nx:flex-1">{contact.role}</span>
      <span className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">{sinceText(contact)}</span>
      <StatusBadge status={contact.state} />
      <div className={HOVER}>
        <Button variant="ghost" size="icon-sm" aria-label={`${contact.name} on LinkedIn`} onClick={() => void attempt(() => api.chrome.openUrl(contact.profileUrl))}>
          <ArrowSquareOutIcon />
        </Button>
      </div>
    </div>
  )
}

const EVENT_ICON: Record<CompanyEvent['kind'], JSX.Element> = { job: <MagnifyingGlassIcon size={14} />, contact: <UserPlusIcon size={14} /> }

export function Timeline({ events }: { events: { key: string; at: string; text: string; icon?: JSX.Element }[] }): JSX.Element {
  if (events.length === 0) return <span className="nx:typography-body-small nx:text-muted-foreground">Nothing yet.</span>
  return (
    <ol className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col">
      {events.map(event => (
        <li key={event.key} className="nx:flex nx:items-center nx:gap-2 nx:min-h-7">
          <span className="nx:inline-flex nx:text-muted-foreground">{event.icon ?? <CheckCircleIcon size={14} />}</span>
          <span className="nx:typography-body-small nx:flex-1 nx:min-w-0">{event.text}</span>
          <span className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">{when(event.at)}</span>
        </li>
      ))}
    </ol>
  )
}

function ExternalLink({ url, label }: { url: string | null; label: string }): JSX.Element {
  if (!url) return <span className="nx:text-muted-foreground">–</span>
  return (
    <button type="button" className="nx:inline-flex nx:items-center nx:gap-1 nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:text-foreground nx:typography-body-small" onClick={() => void attempt(() => api.chrome.openUrl(url))}>
      {label} <ArrowSquareOutIcon size={12} />
    </button>
  )
}

/** One company: its jobs, its people, notes and everything that happened at it. */
export function CompanyScreen({ id }: { id: number }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.companies.get(id), [id], ['opportunities', 'contacts'])
  const company = detail.data?.company
  const [notes, setNotes] = useAutosave(company?.notes, value => api.companies.setNotes(id, value))
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [merging, setMerging] = useState(false)
  const [name, setName] = useState('')
  const [into, setInto] = useState('')
  const [names, setNames] = useState<{ id: number; name: string }[]>([])
  const [refreshRun, setRefreshRun] = useState<number | null>(null)
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const isRefreshing = isBusy && refreshRun !== null && status?.run?.id === refreshRun

  useEffect(() => {
    if (merging) void api.companies.names().then(setNames).catch(() => undefined)
  }, [merging])

  if (detail.error) return <Page title="Company" crumbs={[{ label: 'Tracker', to: '/tracker' }]}><ErrorNote text={detail.error} /></Page>
  if (!detail.data || !company) {
    return (
      <Page title="Company" crumbs={[{ label: 'Tracker', to: '/tracker' }]}>
        {detail.isLoading ? <Loading /> : <ErrorNote text="This company is no longer in the tracker." />}
      </Page>
    )
  }

  const { jobs, contacts, events } = detail.data
  const found = jobs.filter(job => job.status === 'found')
  const connected = contacts.filter(contact => contact.state === 'accepted')
  const requested = contacts.length - connected.length
  const toMessage = connected.filter(contact => !contact.messagedAt).length
  // Requests point at a job: one found, or one applied to that is still open.
  const live = new Set<string>([...(VIEW_STATUSES.found ?? []), ...(VIEW_STATUSES.applied ?? []), ...(VIEW_STATUSES.interviewing ?? [])])
  const canRequest = jobs.some(job => live.has(job.status))
  const hasApplied = jobs.some(job => live.has(job.status) && job.status !== 'found')
  // Refreshing stays on this page: the list fills in as the run finds people.
  const refresh = async (): Promise<void> => {
    const runId = await attempt(() => api.flows.refreshPeople([id]), `Reading your LinkedIn connections at ${company.name}`)
    if (runId) setRefreshRun(runId)
  }

  return (
    <Page
      title={company.name}
      crumbs={[{ label: 'Tracker', to: '/tracker' }]}
      layout="bare"
      actions={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${company.name}`}>
                <DotsThreeIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setName(company.name)
                  setRenaming(true)
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setInto('')
                  setMerging(true)
                }}
              >
                Merge into another company
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {found.length > 0 && (
            <Button size="sm" startIcon={<PaperPlaneTiltIcon />} disabled={isBusy} onClick={() => void attempt(() => api.flows.apply(found.map(job => job.id))).then(runId => runId && go('/run'))}>
              Apply to {found.length} found
            </Button>
          )}
        </>
      }
    >
      <DetailLayout
        main={
          <>
            <div className="nx:flex nx:flex-col nx:gap-2">
              <h1 className="nx:typography-heading-large nx:m-0">{company.name}</h1>
              <Numbers items={[capitalize(company.stage), ...(company.headcount ? [`${company.headcount} people`] : []), `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`]} />
            </div>
            <Group
              title="Jobs"
              action={
                <Button variant="ghost" size="sm" startIcon={<PlusIcon />} onClick={() => setAdding(true)}>
                  Add job
                </Button>
              }
            >
              <Table aria-label={`Jobs at ${company.name}`} density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Portal</TableHead>
                    <TableHead className="nx:text-end">Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>
                      <Hidden>Actions</Hidden>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map(job => (
                    <TableRow key={job.id} className="nx:group">
                      <TableCell>
                        <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground nx:text-left" onClick={() => go(`/opportunity/${job.id}`)}>
                          {job.role}
                        </button>
                      </TableCell>
                      <TableCell className="nx:typography-body-small">{portalName(job.portal) || job.portal}</TableCell>
                      <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{job.score ?? ''}</TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">{day(job.lastTouch)}</TableCell>
                      <TableCell className="nx:text-end">
                        {job.status === 'found' && (
                          <div className="nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100">
                            <Button variant="outline" size="sm" startIcon={<PaperPlaneTiltIcon />} disabled={isBusy} onClick={() => void attempt(() => api.flows.apply([job.id])).then(runId => runId && go('/run'))}>
                              Apply
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Group>
            <Group
              title="People"
              action={
                <div className="nx:flex nx:gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    startIcon={isRefreshing ? <Spinner /> : <ArrowsClockwiseIcon />}
                    disabled={isBusy}
                    title="Reads your LinkedIn connections at this company, and who accepted your requests"
                    onClick={() => void refresh()}
                  >
                    {isRefreshing ? 'Refreshing' : 'Refresh'}
                  </Button>
                  {toMessage > 0 && hasApplied && (
                    <Button variant="ghost" size="sm" startIcon={<ChatCircleIcon />} onClick={() => go(`/message/${encodeURIComponent(company.name)}`)}>
                      Message {toMessage}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    startIcon={<UserPlusIcon />}
                    disabled={isBusy || !canRequest}
                    title={canRequest ? `Up to ${REQUESTS_PER_COMPANY} new people here, never with a note` : 'Requests point at a job: add one here first'}
                    onClick={() => void sendRequests([company.name])}
                  >
                    Send requests
                  </Button>
                </div>
              }
            >
              {contacts.length === 0 ? (
                <span className="nx:typography-body-small nx:text-muted-foreground">No one here yet. Refresh finds your connections here; Send requests reaches new people.</span>
              ) : (
                <div className="nx:flex nx:flex-col nx:gap-1">
                  <Numbers items={[`${connected.length} connected`, `${requested} ${requested === 1 ? 'request' : 'requests'} sent`]} />
                  <div className="nx:flex nx:flex-col">
                    {contacts.map(contact => (
                      <Person key={contact.id} contact={contact} />
                    ))}
                  </div>
                </div>
              )}
            </Group>
            <Group title="Notes">
              <Textarea aria-label="Notes" rows={3} placeholder="Add a note" value={notes} onChange={event => setNotes(event.target.value)} />
            </Group>
            <Group title="Activity">
              <Timeline events={events.map(event => ({ key: event.key, at: event.at, text: event.text, icon: EVENT_ICON[event.kind] }))} />
            </Group>
          </>
        }
        panel={
          <>
            <Props
              items={[
                ['Stage', <Choice key="stage" value={company.stage} options={STAGES} size="sm" variant="borderless" ariaLabel="Stage" onChange={stage => void attempt(() => api.companies.setStage(id, stage))} />],
                ['People', company.headcount ?? '–'],
                ['LinkedIn', <ExternalLink key="li" url={company.linkedinUrl} label="Company page" />],
                ['Website', <ExternalLink key="web" url={company.website} label={company.website?.replace(/^https?:\/\//, '') ?? ''} />],
                ['Added', day(company.added)],
              ]}
            />
            <Separator />
            <div className="nx:flex nx:items-center nx:gap-2">
              <Switch
                id="never-show"
                size="sm"
                checked={company.neverShow}
                onCheckedChange={on => void attempt(() => api.companies.setNeverShow(id, on), on ? 'Hunts will skip it' : 'Shown in hunts again')}
              />
              <Label htmlFor="never-show">Never show in hunts</Label>
              <Tip text="Hunts skip every job here. The company stays in your tracker." />
            </div>
          </>
        }
      />

      <AddJobDialog open={adding} onOpenChange={setAdding} company={company.name} />

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename company</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="rename">Name</FieldLabel>
              <Input id="rename" value={name} onChange={event => setName(event.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || name.trim() === company.name} onClick={() => void attempt(() => api.companies.rename(id, name), 'Renamed').then(() => setRenaming(false))}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={merging} onOpenChange={setMerging}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge {company.name} into</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="merge-into">Company</FieldLabel>
              <NamePicker id="merge-into" value={into} names={names.filter(one => one.id !== id).map(one => one.name)} onChange={setInto} placeholder="Find a company" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMerging(false)}>
              Cancel
            </Button>
            <Button
              disabled={!names.some(one => one.name === into && one.id !== id)}
              onClick={() => {
                const target = names.find(one => one.name === into && one.id !== id)
                if (!target) return
                void attempt(() => api.companies.merge(id, target.id), `Merged into ${target.name}`).then(() => {
                  setMerging(false)
                  go(`/company/${target.id}`)
                })
              }}
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
