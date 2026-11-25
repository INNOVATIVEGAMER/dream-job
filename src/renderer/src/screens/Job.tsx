import { useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, ArrowSquareOutIcon, CaretDownIcon, ChatTextIcon, CheckIcon, DotsThreeIcon, PaperPlaneTiltIcon, StarIcon, WarningIcon } from '@phosphor-icons/react'

import { isPortalLink } from '../../../shared/links'
import { askBlock } from '../../../shared/profile'
import { isUndisclosed, UNDISCLOSED_WHY } from '../../../shared/referral'
import type { JobEdit } from '../../../shared/api'
import { ACTIVE_STATUSES, APPLY_ROUTE_NAMES, OUTREACH_STATE_NAMES, OUTREACH_STATES, SOURCE_NAMES, SOURCES, STATUS_NAMES, STATUSES, WORK_MODE_NAMES, WORK_MODES } from '../../../shared/types'
import type { Application, JobOutreach, OutreachState, PeopleCount, Source, WorkMode } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { useExperience } from '../lib/experience'
import { capitalize, day, initials, plural } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { ActivityTimeline } from '../ui/activity'
import { sendRequests } from '../ui/CommandMenu'
import { attempt, DetailLayout, ErrorNote, Group, Hidden, Loading, Numbers, Page, Props, Tip } from '../ui/common'
import { Choice } from '../ui/fields'
import { checkNumber, InlineCompany, InlineField, InlineLink, InlineNotes } from '../ui/inline'
import {
  Avatar,
  AvatarFallback,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
} from '../ui/nx'
import { AskReferralDialog } from './AskReferral'
import { FormView } from './run/Form'

/** Where an application on the portal itself goes, by route. */
const ON_PORTAL: Record<string, string> = { 'easy-apply': 'Easy Apply', wellfound: 'On Wellfound', instahyre: 'On Instahyre' }

const STATUS_OPTIONS = STATUSES.map(status => ({ value: status, label: STATUS_NAMES[status] }))
const MODE_OPTIONS = WORK_MODES.map(mode => ({ value: mode, label: WORK_MODE_NAMES[mode] }))
const SOURCE_OPTIONS = SOURCES.map(source => ({ value: source, label: SOURCE_NAMES[source] }))
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

/** One application that went out: when, where, who pressed the last button, and its form as it was sent, a click away. */
function SentApplication({ application }: { application: Application }): JSX.Element {
  const count = application.fields.length
  return (
    <div className="nx:flex nx:flex-col nx:gap-1">
      <Numbers
        items={[
          day(application.sent),
          APPLY_ROUTE_NAMES[application.route] ?? application.route,
          application.byUser ? 'You pressed submit in Chrome' : 'Sent after your review',
          ...(application.runId
            ? [
                <button key="run" type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-body-small nx:text-muted-foreground nx:underline" onClick={() => go(`/runs/${application.runId}`)}>
                  Run {application.runId}
                </button>,
              ]
            : []),
        ]}
      />
      {count === 0 ? (
        <span className="nx:typography-body-small nx:text-muted-foreground">No form was read for this one.</span>
      ) : (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" endIcon={<CaretDownIcon />} className="nx:self-start nx:px-0">
              {plural(count, 'answer')} as sent
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="nx:pt-3">
              <FormView fields={application.fields} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

/** One job: the role and why it fits, who was asked about it, what was sent when applying, notes and history, with its status and company beside them. */
export function JobScreen({ id }: { id: number }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.tracker.get(id), [id], ['jobs', 'people'])
  const months = useExperience()
  const job = detail.data?.job
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
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

  const { company, people, outreach, activity, companyJobs, applications } = detail.data
  const companyTo = `/company/${company.id}`
  const isActive = ACTIVE_STATUSES.includes(job.status)
  const save = (change: JobEdit): Promise<void> => api.tracker.edit(job.id, change)
  const tooSenior = askBlock(job.minYears, months)
  // A client a recruiting firm doesn't name: nobody is asked or sent a request.
  const hidden = isUndisclosed(company.name)
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
    <Button
      variant="outline"
      size="sm"
      startIcon={<ChatTextIcon />}
      disabled={!isActive || hidden || !!tooSenior}
      title={
        !isActive
          ? 'Asks point at a job you have applied to'
          : hidden
            ? UNDISCLOSED_WHY
            : tooSenior
              ? `${tooSenior}: more than a year past your experience, so the app won't ask`
              : undefined
      }
      onClick={() => setAsking(true)}
    >
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
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={job.starred ? 'Unstar this job' : 'Star this job'}
            aria-pressed={job.starred}
            title={job.starred ? 'Starred' : 'Star'}
            className={job.starred ? 'nx:text-warning-background' : undefined}
            onClick={() => void attempt(() => api.tracker.setStarred([job.id], !job.starred))}
          >
            <StarIcon weight={job.starred ? 'fill' : 'regular'} />
          </Button>
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
              <DropdownMenuItem disabled={isBusy || hidden} onSelect={() => void sendRequests([job.companyId])}>
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
              <h1 className="nx:m-0">
                <Hidden>{job.role}</Hidden>
              </h1>
              <InlineField heading value={job.role} placeholder="Role" label="Role" check={value => (value ? null : "The role can't be empty")} onSave={value => save({ field: 'role', value })} />
              <Numbers
                items={[
                  companyButton,
                  ...[
                    job.workMode === 'not-stated' ? '' : WORK_MODE_NAMES[job.workMode],
                    // A portal with no count gives a placeholder such as "-": only a count is worth showing.
                    /\d/.test(job.applicants ?? '') ? job.applicants : '',
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
            {applications.length > 0 && (
              <Group title={applications.length === 1 ? 'Application' : 'Applications'}>
                <div className="nx:flex nx:flex-col nx:gap-4">
                  {applications.map(application => (
                    <SentApplication key={application.id} application={application} />
                  ))}
                </div>
              </Group>
            )}
            <Group title="Notes">
              <InlineNotes value={job.notes} placeholder="Add a note" label="Notes" onSave={value => api.tracker.setNotes(job.id, value)} />
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
                ['Company', <InlineCompany key="company" value={company.name} onSave={name => save({ field: 'company', value: name })} />],
                [
                  'Job ID',
                  <InlineField
                    key="req"
                    value={job.reqId ?? ''}
                    placeholder="Not on the posting"
                    label="Job ID"
                    end={<Tip text="The company's own ID, from the posting. Referral messages include it." />}
                    onSave={value => save({ field: 'reqId', value })}
                  />,
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
                  <InlineField
                    key="years"
                    value={job.minYears === null ? '' : String(job.minYears)}
                    display={job.minYears === null ? '' : `${job.minYears}+ ${job.minYears === 1 ? 'year' : 'years'}`}
                    placeholder="Not stated"
                    label="Min experience in years"
                    type="number"
                    suffix="+ years"
                    check={checkNumber(0, 40, 'Min experience')}
                    onSave={value => save({ field: 'minYears', value: value === '' ? null : Number(value) })}
                    below={
                      (tooSenior || job.yearsQuote) && (
                        <div className="nx:flex nx:flex-col nx:gap-0.5 nx:px-2 nx:typography-body-small nx:text-muted-foreground">
                          {tooSenior && <span title={`${tooSenior}: no referral asks for this job`}>Too many to ask for a referral</span>}
                          {/* The words the number rests on: the description's, or the portal's own field when it states none. */}
                          {job.yearsQuote && (
                            <span className="nx:line-clamp-3" title={job.yearsQuote}>
                              {job.yearsQuote}
                            </span>
                          )}
                        </div>
                      )
                    }
                  />,
                ],
                [
                  'Score',
                  <InlineField
                    key="score"
                    value={job.score === null ? '' : String(job.score)}
                    placeholder="No score"
                    label="Score, 1 to 10"
                    type="number"
                    check={checkNumber(1, 10, 'The score')}
                    onSave={value => save({ field: 'score', value: value === '' ? null : Number(value) })}
                  />,
                ],
                [
                  'Found on',
                  <Choice
                    key="portal"
                    value={job.portal}
                    options={SOURCE_OPTIONS}
                    size="sm"
                    variant="borderless"
                    ariaLabel="Found on"
                    onChange={next => void attempt(() => save({ field: 'portal', value: next as Source }))}
                  />,
                ],
                ['Posting', <InlineLink key="posting" value={job.portalLink ?? ''} placeholder="Add the posting link" label="Posting link" onSave={value => save({ field: 'postingLink', value })} />],
                [
                  'Apply page',
                  <InlineLink
                    key="apply"
                    value={job.link ?? ''}
                    placeholder="Add the apply page"
                    label="Apply page link"
                    onSave={value => save({ field: 'applyLink', value })}
                    below={
                      job.postingState === 'unreadable' ? (
                        <span className="nx:flex nx:items-center nx:gap-1 nx:px-2 nx:typography-body-small nx:text-warning-subtle-foreground">
                          <WarningIcon size={14} />
                          Couldn't be read, so the platform's facts stand
                        </span>
                      ) : (
                        job.link &&
                        !isExternal && <span className="nx:px-2 nx:typography-body-small nx:text-muted-foreground">{ON_PORTAL[job.applyRoute ?? ''] ?? `Applies on ${platform}`}</span>
                      )
                    }
                  />,
                ],
                ['Pay', <InlineField key="pay" value={job.pay ?? ''} placeholder="Not shown" label="Pay" onSave={value => save({ field: 'pay', value })} />],
                [
                  'Found',
                  <InlineField
                    key="found"
                    value={job.found.slice(0, 10)}
                    display={day(job.found)}
                    placeholder="Add a date"
                    label="Date found"
                    type="date"
                    check={value => (value ? null : 'Pick a date')}
                    onSave={value => save({ field: 'found', value })}
                  />,
                ],
              ]}
            />
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
