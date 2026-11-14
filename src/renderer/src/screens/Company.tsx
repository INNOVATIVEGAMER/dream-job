import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowSquareOutIcon, ArrowsClockwiseIcon, ChatTextIcon, DotsThreeIcon, PaperPlaneTiltIcon, PlusIcon, UserPlusIcon } from '@phosphor-icons/react'

import { OUTREACH_STATE_NAMES, REQUESTS_PER_COMPANY, SOURCE_NAMES } from '../../../shared/types'
import type { CompanyPerson } from '../../../shared/types'
import { api } from '../lib/api'
import { useAutosave } from '../lib/autosave'
import { useData } from '../lib/data'
import { capitalize, day, initials } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { ActivityTimeline } from '../ui/activity'
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
import { askableJobs, AskReferralDialog } from './AskReferral'

const STAGES = [
  { value: 'startup', label: 'Startup' },
  { value: 'scaleup', label: 'Scaleup' },
  { value: 'large', label: 'Large' },
]

const HOVER = 'nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity'

/** What a person was asked, newest ask first, or where their request stands. Links to the job they were asked about. */
function AskedNote({ person }: { person: CompanyPerson }): JSX.Element {
  const ask = [...person.asked].sort((a, b) => b.sent.localeCompare(a.sent))[0]
  if (ask) {
    const more = person.asked.length - 1
    return (
      <button
        type="button"
        title={more > 0 ? `Asked about ${person.asked.length} jobs` : undefined}
        className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-body-small nx:text-foreground nx:underline nx:whitespace-nowrap"
        onClick={() => go(`/job/${ask.jobId}`)}
      >
        Asked about {ask.role} · {OUTREACH_STATE_NAMES[ask.state]}
        {more > 0 ? ` +${more}` : ''}
      </button>
    )
  }
  const text = person.state === 'connected' ? 'Not asked yet' : person.requested ? `Sent ${day(person.requested)}` : ''
  return <span className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{text}</span>
}

/** One person at the company: what they were asked, where they stand, and their LinkedIn. */
function PersonRow({ person }: { person: CompanyPerson }): JSX.Element {
  return (
    <div className={`nx:group nx:flex nx:items-center nx:gap-2 nx:min-h-9 ${person.current ? '' : 'nx:opacity-64'}`}>
      <Avatar size="xs">
        <AvatarFallback>{initials(person.name)}</AvatarFallback>
      </Avatar>
      <span className="nx:typography-label-default nx:whitespace-nowrap">{person.name}</span>
      <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate nx:flex-1 nx:min-w-0">{person.headline}</span>
      <AskedNote person={person} />
      <StatusBadge status={person.current ? person.state : 'left'} />
      <div className={HOVER}>
        <Button variant="ghost" size="icon-sm" aria-label={`${person.name} on LinkedIn`} onClick={() => void attempt(() => api.chrome.openUrl(person.profileUrl))}>
          <ArrowSquareOutIcon />
        </Button>
      </div>
    </div>
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

/** One company: its jobs, its people and what each was asked, notes and everything that happened at it. */
export function CompanyScreen({ id, asking = false }: { id: number; asking?: boolean }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.companies.get(id), [id], ['jobs', 'people'])
  const company = detail.data?.company
  const [notes, setNotes] = useAutosave(company?.notes, value => api.companies.setNotes(id, value))
  const [adding, setAdding] = useState(false)
  const [isAsking, setAsking] = useState(asking)
  const [renaming, setRenaming] = useState(false)
  const [merging, setMerging] = useState(false)
  const [name, setName] = useState('')
  const [into, setInto] = useState('')
  const [names, setNames] = useState<{ id: number; name: string }[]>([])
  const [refreshRun, setRefreshRun] = useState<number | null>(null)
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const isRefreshing = isBusy && refreshRun !== null && status?.run?.id === refreshRun

  useEffect(() => setAsking(asking), [asking])
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

  const { jobs, people, activity } = detail.data
  const current = people.filter(person => person.current)
  // Connected first, then requests still out; people who left come after, on their own.
  const here = [...current.filter(person => person.state === 'connected'), ...current.filter(person => person.state !== 'connected')]
  const left = people.filter(person => !person.current)
  const connected = current.filter(person => person.state === 'connected').length
  const requested = current.length - connected
  const canAsk = askableJobs(jobs).length > 0
  // Requests point at a job: one found, or one applied to that is still in play.
  const canRequest = jobs.some(job => job.status === 'found') || canAsk
  // Refreshing stays on this page: the list fills in as the run finds people.
  const refresh = async (): Promise<void> => {
    const runId = await attempt(() => api.flows.refreshPeople([id]), `Reading your LinkedIn connections at ${company.name}`)
    if (runId) setRefreshRun(runId)
  }
  const apply = async (jobId: number): Promise<void> => {
    if (await attempt(() => api.flows.apply([jobId]))) go('/run')
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
          <Button size="sm" startIcon={<ChatTextIcon />} disabled={!canAsk} title={canAsk ? undefined : 'Asks point at a job you have applied to'} onClick={() => setAsking(true)}>
            Ask for a referral
          </Button>
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
                        <button type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground nx:text-left" onClick={() => go(`/job/${job.id}`)}>
                          {job.role}
                        </button>
                      </TableCell>
                      <TableCell className="nx:typography-body-small">{SOURCE_NAMES[job.portal] ?? job.portal}</TableCell>
                      <TableCell className="nx:text-end nx:tabular-nums nx:typography-body-small">{job.score ?? ''}</TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums">{day(job.updated)}</TableCell>
                      <TableCell className="nx:text-end">
                        {job.status === 'found' && (
                          <div className={HOVER}>
                            <Button variant="outline" size="sm" startIcon={<PaperPlaneTiltIcon />} disabled={isBusy} onClick={() => void apply(job.id)}>
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
                  <Button
                    variant="outline"
                    size="sm"
                    startIcon={<UserPlusIcon />}
                    disabled={isBusy || !canRequest}
                    title={canRequest ? `Up to ${REQUESTS_PER_COMPANY} new people here, never with a note` : 'Requests point at a job: add one here first'}
                    onClick={() => void sendRequests([id])}
                  >
                    Send requests
                  </Button>
                </div>
              }
            >
              {people.length === 0 ? (
                <span className="nx:typography-body-small nx:text-muted-foreground">No one here yet. Refresh finds your connections here; Send requests reaches new people.</span>
              ) : (
                <div className="nx:flex nx:flex-col nx:gap-2">
                  <Numbers
                    items={[
                      <span key="connected" className="nx:text-foreground">
                        {connected} connected
                      </span>,
                      `${requested} ${requested === 1 ? 'request' : 'requests'} sent`,
                      ...(left.length ? [`${left.length} left`] : []),
                    ]}
                  />
                  {here.length > 0 && (
                    <div className="nx:flex nx:flex-col">
                      {here.map(person => (
                        <PersonRow key={person.id} person={person} />
                      ))}
                    </div>
                  )}
                  {left.length > 0 && (
                    <>
                      <span className="nx:typography-label-caps nx:text-muted-foreground">Left {company.name}</span>
                      <div className="nx:flex nx:flex-col">
                        {left.map(person => (
                          <PersonRow key={person.id} person={person} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </Group>
            <Group title="Notes">
              <Textarea aria-label="Notes" rows={3} placeholder="Add a note" value={notes} onChange={event => setNotes(event.target.value)} />
            </Group>
            <Group title="Activity">
              <ActivityTimeline activity={activity} />
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

      <AskReferralDialog
        open={isAsking}
        companyId={id}
        onOpenChange={on => {
          setAsking(on)
          if (!on && asking) go(`/company/${id}`)
        }}
      />

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
