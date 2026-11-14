import { useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, ArrowSquareOutIcon, ChatTextIcon, CheckIcon, DotsThreeIcon, LinkIcon, PaperPlaneTiltIcon, WarningIcon } from '@phosphor-icons/react'

import { isPortalLink } from '../../../shared/links'
import { ACTIVE_STATUSES, OUTREACH_STATE_NAMES, OUTREACH_STATES, SOURCE_NAMES, STATUS_NAMES, STATUSES, WORK_MODE_NAMES, WORK_MODES } from '../../../shared/types'
import type { Job, JobOutreach, OutreachState, PeopleCount, WorkMode } from '../../../shared/types'
import { api } from '../lib/api'
import { useAutosave } from '../lib/autosave'
import { useData } from '../lib/data'
import { capitalize, day, initials } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { ActivityTimeline } from '../ui/activity'
import { sendRequests } from '../ui/CommandMenu'
import { attempt, DetailLayout, ErrorNote, Group, Hidden, Loading, Numbers, Page, Props, Tip } from '../ui/common'
import { Choice } from '../ui/fields'
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '../ui/nx'
import { AskReferralDialog } from './AskReferral'

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A link shown as text that opens in the app's Chrome. */
function LinkButton({ label, url }: { label: string; url: string }): JSX.Element {
  return (
    <button type="button" className="nx:inline-flex nx:items-center nx:gap-1 nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-body-small nx:text-foreground nx:underline" onClick={() => void attempt(() => api.chrome.openUrl(url))}>
      {label}
      <ArrowSquareOutIcon size={12} />
    </button>
  )
}

/** Where an application on the portal itself goes, by route. */
const ON_PORTAL: Record<string, string> = { 'easy-apply': 'Easy Apply', wellfound: 'On Wellfound', instahyre: 'On Instahyre' }

/** The job's two links, as the user pastes them: the posting where it was found, and where the application goes. */
function LinksDialog({ job, onClose }: { job: Job; onClose: () => void }): JSX.Element {
  const [postingLink, setPostingLink] = useState(job.portalLink ?? '')
  const [applyLink, setApplyLink] = useState(job.link ?? '')
  const save = async (): Promise<void> => {
    if (await attempt(() => api.tracker.setLinks(job.id, { postingLink: postingLink.trim(), applyLink: applyLink.trim() }).then(() => true), 'Links saved')) onClose()
  }
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Links</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="link-posting">{job.portal === 'manual' ? 'Posting' : `Posting, on ${SOURCE_NAMES[job.portal]}`}</FieldLabel>
              <Input id="link-posting" type="url" placeholder="https://" value={postingLink} onChange={event => setPostingLink(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="link-apply">Where the application goes</FieldLabel>
              <Input id="link-apply" type="url" placeholder="https://" value={applyLink} onChange={event => setApplyLink(event.target.value)} />
              <FieldDescription>The company's apply page, or the posting itself when you apply on the platform. Referral messages send this one.</FieldDescription>
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save links</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const STATUS_OPTIONS = STATUSES.map(status => ({ value: status, label: STATUS_NAMES[status] }))
const MODE_OPTIONS = WORK_MODES.map(mode => ({ value: mode, label: WORK_MODE_NAMES[mode] }))
const OUTREACH_OPTIONS = OUTREACH_STATES.map(state => ({ value: state, label: OUTREACH_STATE_NAMES[state] }))

/** "4 connected · 1 request sent", or "no people yet". */
const peopleLine = (people: PeopleCount): string =>
  people.connected || people.requested ? `${people.connected} connected · ${people.requested} ${people.requested === 1 ? 'request' : 'requests'} sent` : 'no people yet'

/** One ask: who, when, where it stands (you set it), and the message as it went. */
function AskRow({ ask }: { ask: JobOutreach }): JSX.Element {
  return (
    <TableRow>
      <TableCell>
        <div className={`nx:flex nx:items-center nx:gap-2 nx:min-w-0 ${ask.current ? '' : 'nx:opacity-64'}`}>
          <Avatar size="xs">
            <AvatarFallback>{initials(ask.name)}</AvatarFallback>
          </Avatar>
          <div className="nx:flex nx:flex-col nx:min-w-0">
            <span className="nx:typography-label-default nx:whitespace-nowrap">{ask.name}</span>
            <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{ask.current ? ask.headline : `Left · ${ask.headline}`}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:tabular-nums nx:whitespace-nowrap">{day(ask.sent)}</TableCell>
      <TableCell>
        <Choice
          value={ask.state}
          options={OUTREACH_OPTIONS}
          size="sm"
          variant="borderless"
          ariaLabel={`Where the ask to ${ask.name} stands`}
          onChange={state => void attempt(() => api.outreach.setState(ask.id, state as OutreachState))}
        />
      </TableCell>
      <TableCell className="nx:text-end">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Read the message to ${ask.name}`}>
              <ChatTextIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="nx:w-96">
            <div className="nx:flex nx:flex-col nx:gap-2">
              <span className="nx:typography-body-small nx:whitespace-pre-wrap">{ask.message}</span>
              <span className="nx:typography-body-small nx:text-muted-foreground">{ask.resume ? 'Sent with your resume' : 'Sent without your resume'}</span>
            </div>
          </PopoverContent>
        </Popover>
      </TableCell>
    </TableRow>
  )
}

/** One job: the role and why it fits, who was asked about it, notes and history, with its status and company beside them. */
export function JobScreen({ id }: { id: number }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.tracker.get(id), [id], ['jobs', 'people'])
  const job = detail.data?.job
  const [notes, setNotes] = useAutosave(job?.notes, value => api.tracker.setNotes(id, value))
  const [reqId, setReqId] = useAutosave(job ? (job.reqId ?? '') : undefined, value => api.tracker.setReqId(id, value.trim()))
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const [isEditingLinks, setIsEditingLinks] = useState(false)
  const [isAsking, setAsking] = useState(false)

  const crumbs = [{ label: 'Tracker', to: '/tracker' }]
  if (detail.error) return <Page title="Job" crumbs={crumbs}><ErrorNote text={detail.error} /></Page>
  if (!detail.data || !job) {
    return (
      <Page title="Job" crumbs={crumbs}>
        {detail.isLoading ? <Loading /> : <ErrorNote text="This job is no longer in the tracker." />}
      </Page>
    )
  }

  const { company, people, outreach, activity, companyJobs } = detail.data
  const companyTo = `/company/${company.id}`
  const isActive = ACTIVE_STATUSES.includes(job.status)
  const apply = async (): Promise<void> => {
    if (await attempt(() => api.flows.apply([job.id]))) go('/run')
  }
  // The application goes to the company's own page, not the portal it was found on.
  const isExternal = !!job.link && !isPortalLink(job.link)
  const platform = SOURCE_NAMES[job.portal] ?? job.portal
  const opens = job.link ?? job.portalLink
  const companyButton = (
    <button key="company" type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground" onClick={() => go(companyTo)}>
      {company.name}
    </button>
  )
  const askButton = (
    <Button variant="outline" size="sm" startIcon={<ChatTextIcon />} disabled={!isActive} title={isActive ? undefined : 'Asks point at a job you have applied to'} onClick={() => setAsking(true)}>
      Ask for a referral
    </Button>
  )

  return (
    <Page
      title={job.role}
      crumbs={[...crumbs, { label: company.name, to: companyTo }]}
      layout="bare"
      actions={
        <>
          {opens && (
            <Button variant="ghost" size="sm" endIcon={<ArrowSquareOutIcon />} onClick={() => void attempt(() => api.chrome.openUrl(opens))}>
              {isExternal ? 'Apply page' : 'Posting'}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More for this job">
                <DotsThreeIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => go(companyTo)}>Open company</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setIsEditingLinks(true)}>Edit links</DropdownMenuItem>
              <DropdownMenuItem disabled={isBusy} onSelect={() => void sendRequests([job.companyId])}>
                Send connection requests
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {job.status === 'found' && (
            <Button size="sm" startIcon={<PaperPlaneTiltIcon />} disabled={isBusy} onClick={() => void apply()}>
              Apply
            </Button>
          )}
        </>
      }
    >
      <DetailLayout
        main={
          <>
            <div className="nx:flex nx:flex-col nx:gap-2">
              <h1 className="nx:typography-heading-large nx:m-0">{job.role}</h1>
              <Numbers
                items={[
                  companyButton,
                  ...[
                    job.workMode === 'not-stated' ? '' : WORK_MODE_NAMES[job.workMode],
                    job.applicants,
                    typeof job.minYears === 'number' ? `${job.minYears}+ years` : '',
                    job.pay ?? 'Pay not shown',
                  ].filter(Boolean),
                ]}
              />
            </div>
            {job.scoreReasons.length > 0 && (
              <Group title={`Why it scored ${job.score ?? ''}`}>
                <ul className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col">
                  {job.scoreReasons.map(reason => (
                    <li key={reason} className="nx:flex nx:items-center nx:gap-2 nx:min-h-7 nx:typography-body-small">
                      <CheckIcon size={14} className="nx:text-success-subtle-foreground" />
                      {reason}
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            {isActive || outreach.length > 0 ? (
              <Group title="Outreach" action={askButton}>
                {outreach.length === 0 ? (
                  <span className="nx:typography-body-small nx:text-muted-foreground">
                    No one asked yet. At {company.name}: {peopleLine(people)}.
                  </span>
                ) : (
                  <div className="nx:flex nx:flex-col nx:gap-2">
                    <Table aria-label="Outreach for this job" density="compact">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Person</TableHead>
                          <TableHead>Asked</TableHead>
                          <TableHead>Where it stands</TableHead>
                          <TableHead>
                            <Hidden>Message</Hidden>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {outreach.map(ask => (
                          <AskRow key={ask.id} ask={ask} />
                        ))}
                      </TableBody>
                    </Table>
                    <span className="nx:typography-body-small nx:text-muted-foreground">You set where each ask stands. The email check leaves these alone.</span>
                  </div>
                )}
              </Group>
            ) : (
              <Group
                title={`People at ${company.name}`}
                action={
                  <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go(companyTo)}>
                    Open company
                  </Button>
                }
              >
                <span className="nx:typography-body-small">{capitalize(peopleLine(people))}</span>
                {job.status === 'found' && <span className="nx:typography-body-small nx:text-muted-foreground">You can ask them for a referral once you have applied.</span>}
              </Group>
            )}
            <Group title="Notes">
              <Textarea aria-label="Notes" rows={Math.min(14, Math.max(3, notes.split('\n').length + 1))} placeholder="Add a note" value={notes} onChange={event => setNotes(event.target.value)} />
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
                ['Status', <Choice key="status" value={job.status} options={STATUS_OPTIONS} size="sm" variant="borderless" ariaLabel="Status" onChange={next => void attempt(() => api.tracker.setStatus(job.id, next))} />],
                [
                  'Job ID',
                  <span key="req" className="nx:flex nx:items-center nx:gap-1">
                    <Input size="sm" variant="ghost" aria-label="Job ID" placeholder="Not on the posting" value={reqId} onChange={event => setReqId(event.target.value)} />
                    <Tip text="The company's own ID, from the posting. Referral messages include it." />
                  </span>,
                ],
                [
                  'Work mode',
                  <Choice
                    key="mode"
                    value={job.workMode}
                    options={MODE_OPTIONS}
                    size="sm"
                    variant="borderless"
                    ariaLabel="Work mode"
                    onChange={next => void attempt(() => api.tracker.setWorkMode(job.id, next as WorkMode))}
                  />,
                ],
                [
                  'Min experience',
                  typeof job.minYears === 'number' ? (
                    `${job.minYears}+ ${job.minYears === 1 ? 'year' : 'years'}`
                  ) : (
                    <span key="years" className="nx:text-muted-foreground">
                      Not stated
                    </span>
                  ),
                ],
                ['Score', job.score ?? '–'],
                [
                  'Found on',
                  job.portalLink ? (
                    <LinkButton key="found" label={platform} url={job.portalLink} />
                  ) : job.portal === 'manual' ? (
                    platform
                  ) : (
                    <span key="found">
                      {platform} <span className="nx:text-muted-foreground">· No link</span>
                    </span>
                  ),
                ],
                [
                  'Apply at',
                  !job.link ? (
                    <span key="via" className="nx:text-muted-foreground">
                      No link
                    </span>
                  ) : (
                    <span key="via" className="nx:flex nx:items-center nx:gap-1 nx:min-w-0">
                      <LinkButton label={isExternal ? hostOf(job.link) : (ON_PORTAL[job.applyRoute ?? ''] ?? `On ${platform}`)} url={job.link} />
                      {job.postingState === 'unreadable' && (
                        <span title="This apply page couldn't be read, so the platform's facts stand" className="nx:inline-flex nx:text-warning-subtle-foreground">
                          <WarningIcon size={14} />
                        </span>
                      )}
                    </span>
                  ),
                ],
                ['Pay', job.pay ?? 'Not shown'],
                ['Found', day(job.found)],
              ]}
            />
            {(!job.portalLink || !job.link) && (
              <div>
                <Button variant="ghost" size="sm" startIcon={<LinkIcon />} onClick={() => setIsEditingLinks(true)}>
                  Add links
                </Button>
              </div>
            )}
            {isEditingLinks && <LinksDialog job={job} onClose={() => setIsEditingLinks(false)} />}
            <Separator />
            <Group title="Company">
              <button type="button" className="nx:flex nx:items-center nx:gap-2 nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:text-left" onClick={() => go(companyTo)}>
                <span className="nx:typography-label-default nx:text-foreground">{company.name}</span>
                <span className="nx:typography-body-small nx:text-muted-foreground">{capitalize(company.stage)}</span>
                <ArrowRightIcon size={12} />
              </button>
              <span className="nx:typography-body-small nx:text-muted-foreground">
                {companyJobs} {companyJobs === 1 ? 'job' : 'jobs'} · {peopleLine(people)}
              </span>
            </Group>
          </>
        }
      />
      <AskReferralDialog open={isAsking} onOpenChange={setAsking} companyId={job.companyId} jobId={job.id} />
    </Page>
  )
}
