import { useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, ArrowSquareOutIcon, CheckIcon, DotsThreeIcon, LinkIcon, PaperPlaneTiltIcon, WarningIcon } from '@phosphor-icons/react'

import { isPortalLink } from '../../../shared/links'
import { STATUSES, WORK_MODE_NAMES, WORK_MODES } from '../../../shared/types'
import type { Opportunity as Job, WorkMode } from '../../../shared/types'
import { api } from '../lib/api'
import { useAutosave } from '../lib/autosave'
import { useData } from '../lib/data'
import { capitalize, day, portalName } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, DetailLayout, ErrorNote, Group, Loading, Numbers, Page, Props, Tip } from '../ui/common'
import { Choice } from '../ui/fields'
import {
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
  Separator,
  Textarea,
} from '../ui/nx'
import { Timeline } from './Company'

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
              <FieldLabel htmlFor="link-posting">Posting, on {portalName(job.portal) || job.portal}</FieldLabel>
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

const STATUS_OPTIONS = STATUSES.map(status => ({ value: status, label: capitalize(status) }))
const MODE_OPTIONS = WORK_MODES.map(mode => ({ value: mode, label: WORK_MODE_NAMES[mode] }))

/** One job: the role and why it fits, what was sent, notes and history, with its status and company beside them. */
export function Opportunity({ id }: { id: number }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.tracker.get(id), [id], ['opportunities', 'contacts'])
  const row = detail.data?.opportunity
  const [notes, setNotes] = useAutosave(row?.notes, value => api.tracker.setNotes(id, value))
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const [isEditingLinks, setIsEditingLinks] = useState(false)

  const crumbs = [{ label: 'Tracker', to: '/tracker' }]
  if (detail.error) return <Page title="Job" crumbs={crumbs}><ErrorNote text={detail.error} /></Page>
  if (!detail.data || !row) {
    return (
      <Page title="Job" crumbs={crumbs}>
        {detail.isLoading ? <Loading /> : <ErrorNote text="This job is no longer in the tracker." />}
      </Page>
    )
  }

  const company = detail.data.company
  const contacts = detail.data.contacts
  const companyTo = company ? `/company/${company.id}` : null
  const accepted = contacts.filter(contact => contact.state === 'accepted').length
  const pending = contacts.filter(contact => contact.state === 'pending').length
  const apply = async (): Promise<void> => {
    if (await attempt(() => api.flows.apply([row.id]))) go('/run')
  }
  // The application goes to the company's own page, not the portal it was found on.
  const isExternal = !!row.link && !isPortalLink(row.link)
  const platform = portalName(row.portal) || row.portal
  const opens = row.link ?? row.portalLink
  // The words the years were read from, when a run read them off the posting.
  const yearsQuote = typeof row.minYears === 'number' && row.experience && row.experience !== 'not stated' ? row.experience : null

  return (
    <Page
      title={row.role}
      crumbs={company ? [...crumbs, { label: company.name, to: companyTo! }] : crumbs}
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
              {companyTo && <DropdownMenuItem onSelect={() => go(companyTo)}>Open company</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => setIsEditingLinks(true)}>Edit links</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => go(`/contacts/connect/${encodeURIComponent(row.company)}`)}>Send connection requests</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {row.status === 'found' && (
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
              <h1 className="nx:typography-heading-large nx:m-0">{row.role}</h1>
              <Numbers
                items={[
                  companyTo ? (
                    <button key="company" type="button" className="nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-label-default nx:text-foreground" onClick={() => go(companyTo)}>
                      {row.company}
                    </button>
                  ) : (
                    row.company
                  ),
                  ...[row.mode, row.applicants, row.experience, row.pay ?? 'Pay not shown'].filter(Boolean),
                ]}
              />
            </div>
            {row.scoreReasons.length > 0 && (
              <Group title={`Why it scored ${row.score ?? ''}`}>
                <ul className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col">
                  {row.scoreReasons.map(reason => (
                    <li key={reason} className="nx:flex nx:items-center nx:gap-2 nx:min-h-7 nx:typography-body-small">
                      <CheckIcon size={14} className="nx:text-success-subtle-foreground" />
                      {reason}
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            <Group title="Notes">
              <Textarea aria-label="Notes" rows={Math.min(14, Math.max(3, notes.split('\n').length + 1))} placeholder="Add a note" value={notes} onChange={event => setNotes(event.target.value)} />
            </Group>
            <Group title="Activity">
              <Timeline events={detail.data.events.map(event => ({ key: String(event.id), at: event.at, text: event.text }))} />
            </Group>
          </>
        }
        panel={
          <>
            <Props
              items={[
                ['Status', <Choice key="status" value={row.status} options={STATUS_OPTIONS} size="sm" variant="borderless" ariaLabel="Status" onChange={next => void attempt(() => api.tracker.setStatus(row.id, next))} />],
                [
                  'Work mode',
                  <Choice
                    key="mode"
                    value={row.workMode}
                    options={MODE_OPTIONS}
                    size="sm"
                    variant="borderless"
                    ariaLabel="Work mode"
                    onChange={next => void attempt(() => api.tracker.setWorkMode(row.id, next as WorkMode))}
                  />,
                ],
                [
                  'Min experience',
                  typeof row.minYears === 'number' ? (
                    <span key="years" className="nx:flex nx:items-center nx:gap-1">
                      {row.minYears}+ {row.minYears === 1 ? 'year' : 'years'}
                      {yearsQuote && <Tip text={`From the posting: "${yearsQuote}"`} />}
                    </span>
                  ) : (
                    <span key="years" className="nx:text-muted-foreground">Not stated</span>
                  ),
                ],
                ['Score', row.score ?? '–'],
                [
                  'Found on',
                  row.portalLink ? (
                    <LinkButton key="found" label={platform} url={row.portalLink} />
                  ) : (
                    <span key="found">
                      {platform} <span className="nx:text-muted-foreground">· No link</span>
                    </span>
                  ),
                ],
                [
                  'Apply at',
                  !row.link ? (
                    <span key="via" className="nx:text-muted-foreground">
                      No link
                    </span>
                  ) : (
                    <span key="via" className="nx:flex nx:items-center nx:gap-1 nx:min-w-0">
                      <LinkButton label={isExternal ? hostOf(row.link) : (ON_PORTAL[row.applyRoute ?? ''] ?? `On ${platform}`)} url={row.link} />
                      {row.postingState === 'unreadable' && (
                        <span title="This apply page couldn't be read, so the platform's facts stand" className="nx:inline-flex nx:text-warning-subtle-foreground">
                          <WarningIcon size={14} />
                        </span>
                      )}
                    </span>
                  ),
                ],
                ['Pay', row.pay ?? 'Not shown'],
                ['Found', day(row.found)],
              ]}
            />
            {(!row.portalLink || !row.link) && (
              <div>
                <Button variant="ghost" size="sm" startIcon={<LinkIcon />} onClick={() => setIsEditingLinks(true)}>
                  Add links
                </Button>
              </div>
            )}
            {isEditingLinks && <LinksDialog job={row} onClose={() => setIsEditingLinks(false)} />}
            {company && (
              <>
                <Separator />
                <Group title="Company">
                  <button type="button" className="nx:flex nx:items-center nx:gap-2 nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:text-left" onClick={() => go(companyTo!)}>
                    <span className="nx:typography-label-default nx:text-foreground">{company.name}</span>
                    <span className="nx:typography-body-small nx:text-muted-foreground">{capitalize(company.stage)}</span>
                    <ArrowRightIcon size={12} />
                  </button>
                  <span className="nx:typography-body-small nx:text-muted-foreground">
                    {detail.data.companyJobs} {detail.data.companyJobs === 1 ? 'job' : 'jobs'}
                    {contacts.length ? ` · ${accepted} accepted, ${pending} pending` : ' · no contacts yet'}
                  </span>
                </Group>
              </>
            )}
          </>
        }
      />
    </Page>
  )
}
