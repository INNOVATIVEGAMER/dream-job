import { useMemo, useState } from 'react'
import type { JSX } from 'react'

import { PaperPlaneTiltIcon, WarningIcon } from '@phosphor-icons/react'

import { fillTemplate, firstName } from '../../../shared/referral'
import { ACTIVE_STATUSES, STATUS_NAMES } from '../../../shared/types'
import type { CompanyPerson, JobRow } from '../../../shared/types'
import { api, messageOf } from '../lib/api'
import { useData } from '../lib/data'
import { day } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, ErrorNote, Loading } from '../ui/common'
import { Choice } from '../ui/fields'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Label,
  Switch,
} from '../ui/nx'

/** The jobs an ask can point at: past applying and still in play, the most recently updated first. */
export function askableJobs(jobs: JobRow[]): JobRow[] {
  return jobs.filter(job => ACTIVE_STATUSES.includes(job.status)).sort((a, b) => b.updated.localeCompare(a.updated))
}

/** One person at the company, and why they can't be asked about this job; `why` is null for someone who can. */
type Candidate = { person: CompanyPerson; why: string | null }

/** The people working there now: those who can be asked first, then those already asked, then requests still out. */
function candidatesFor(people: CompanyPerson[], jobId: number): Candidate[] {
  const rank = (one: Candidate): number => (one.why === null ? 0 : one.person.state === 'connected' ? 1 : 2)
  return people
    .filter(person => person.current)
    .map(person => {
      const ask = person.asked.find(one => one.jobId === jobId)
      if (ask) return { person, why: `Asked ${day(ask.sent)}` }
      if (person.state !== 'connected') return { person, why: 'Not connected yet' }
      return { person, why: null }
    })
    .sort((a, b) => rank(a) - rank(b))
}

/** What stops the message for one of the picked people, in the words fillTemplate gives. */
function fillError(fill: (person: CompanyPerson) => string, people: CompanyPerson[]): string | null {
  for (const person of people) {
    try {
      fill(person)
    } catch (error) {
      return messageOf(error)
    }
  }
  return null
}

function Ask({ companyId, jobId, onClose }: { companyId: number; jobId?: number; onClose: () => void }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.companies.get(companyId), [companyId], ['jobs', 'people'])
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const jobs = useMemo(() => askableJobs(detail.data?.jobs ?? []), [detail.data])
  const [pickedJob, setPickedJob] = useState<number | null>(null)
  const [chosen, setChosen] = useState<number[] | null>(null)
  const [resume, setResume] = useState<boolean | null>(null)
  const chosenJobId = pickedJob ?? (jobId !== undefined && jobs.some(job => job.id === jobId) ? jobId : (jobs[0]?.id ?? null))
  // The job's own id is on the job page only, so the preview reads it there.
  const job = useData(() => (chosenJobId === null ? Promise.resolve(null) : api.tracker.get(chosenJobId)), [chosenJobId], ['jobs'])
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  const header = (
    <DialogHeader>
      <DialogTitle>Ask for a referral</DialogTitle>
    </DialogHeader>
  )
  if (detail.error || settings.error) {
    return (
      <>
        {header}
        <DialogBody>
          <ErrorNote text={detail.error ?? settings.error ?? ''} />
        </DialogBody>
      </>
    )
  }
  if (!detail.data || !settings.data) {
    return (
      <>
        {header}
        <DialogBody>
          <Loading />
        </DialogBody>
      </>
    )
  }

  const company = detail.data.company
  const template = settings.data.referral.template
  const hasResume = !!settings.data.resume
  const attach = hasResume && (resume ?? settings.data.referral.attachResume)
  const candidates = chosenJobId === null ? [] : candidatesFor(detail.data.people, chosenJobId)
  const available = candidates.filter(one => one.why === null).map(one => one.person.id)
  const picked = (chosen ?? available).filter(id => available.includes(id))
  const pickedPeople = candidates.filter(one => picked.includes(one.person.id)).map(one => one.person)
  const target = job.data && job.data.job.id === chosenJobId ? job.data.job : null
  const fill = (person: CompanyPerson): string =>
    fillTemplate(template, { name: firstName(person.name), role: target?.role ?? '', company: company.name, jobId: target?.reqId ?? '', jobLink: target?.link || target?.portalLink || '' })
  const first = pickedPeople[0]
  const problem = target ? fillError(fill, pickedPeople) : null
  const preview = target && first && !problem ? fill(first) : null
  const toggle = (id: number, on: boolean): void => setChosen(on ? [...picked, id] : picked.filter(one => one !== id))
  const send = async (): Promise<void> => {
    if (chosenJobId === null) return
    if (await attempt(() => api.flows.referral({ jobId: chosenJobId, personIds: picked, resume: attach }))) go('/run')
  }

  if (jobs.length === 0) {
    return (
      <>
        {header}
        <DialogBody>
          <span className="nx:typography-body-small nx:text-muted-foreground">Asks point at a job you have applied to. Apply to a job at {company.name} first.</span>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      {header}
      <DialogBody>
        <FieldGroup>
          {!template.trim() && (
            <Alert variant="warning" layout="inline">
              <AlertIcon>
                <WarningIcon />
              </AlertIcon>
              <AlertContent>
                <AlertDescription>Save your referral message first.</AlertDescription>
              </AlertContent>
              <Button variant="outline" size="sm" onClick={() => go('/settings/message')}>
                Open Settings
              </Button>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="ask-job">Job</FieldLabel>
            <Choice
              id="ask-job"
              value={String(chosenJobId)}
              options={jobs.map(one => ({ value: String(one.id), label: one.role }))}
              onChange={value => {
                setPickedJob(Number(value))
                setChosen(null)
              }}
            />
            {target && <FieldDescription>{[target.reqId ? `Job ID ${target.reqId}` : 'No job ID', STATUS_NAMES[target.status]].join(' · ')}</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel>People</FieldLabel>
            {candidates.length === 0 ? (
              <span className="nx:typography-body-small nx:text-muted-foreground">No one at {company.name} yet. Refresh on the company page finds your connections there.</span>
            ) : (
              <div className="nx:flex nx:flex-col">
                {candidates.map(({ person, why }) => {
                  const id = `ask-person-${person.id}`
                  return (
                    <div key={person.id} className={`nx:flex nx:items-center nx:gap-2 nx:min-h-9 ${why ? 'nx:opacity-64' : ''}`}>
                      <Checkbox id={id} disabled={why !== null} checked={picked.includes(person.id)} onCheckedChange={on => toggle(person.id, on === true)} />
                      <Label htmlFor={id} className="nx:whitespace-nowrap">
                        {person.name}
                      </Label>
                      <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate nx:flex-1 nx:min-w-0">{person.headline}</span>
                      <span className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{why ?? 'Connected'}</span>
                    </div>
                  )
                })}
              </div>
            )}
            <FieldDescription>Connected people at {company.name} who haven't been asked about this job</FieldDescription>
          </Field>
          {problem ? (
            <ErrorNote text={problem} />
          ) : (
            preview &&
            first && (
              <div className="nx:flex nx:flex-col nx:gap-2">
                <div className="nx:flex nx:items-center nx:justify-between nx:gap-2">
                  <span className="nx:typography-label-caps nx:text-muted-foreground">Preview, for {first.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => go('/settings/message')}>
                    Edit in Settings
                  </Button>
                </div>
                <div className="nx:rounded-md nx:bg-muted nx:p-4 nx:typography-body-small nx:whitespace-pre-wrap">{preview}</div>
              </div>
            )
          )}
          <div className="nx:flex nx:items-center nx:gap-2">
            <Switch id="ask-resume" size="sm" disabled={!hasResume} checked={attach} onCheckedChange={on => setResume(on)} />
            <Label htmlFor="ask-resume">Attach your resume</Label>
            {!hasResume && <span className="nx:typography-body-small nx:text-muted-foreground">No resume saved yet</span>}
          </div>
        </FieldGroup>
      </DialogBody>
      <DialogFooter>
        <span className="nx:flex-1 nx:self-center nx:typography-body-small nx:text-muted-foreground">{isBusy ? 'Another run is going.' : 'Sent word for word, one person at a time'}</span>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button startIcon={<PaperPlaneTiltIcon />} disabled={isBusy || !target || picked.length === 0 || !!problem || !template.trim()} onClick={() => void send()}>
          Send to {picked.length}
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * Asks connected people at one company for a referral to one of its jobs,
 * with the saved message, word for word. Opened from the company and from a job.
 */
export function AskReferralDialog({ open, onOpenChange, companyId, jobId }: { open: boolean; onOpenChange: (open: boolean) => void; companyId: number; jobId?: number }): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The content mounts only while open, so each opening starts fresh. */}
      <DialogContent>
        <Ask companyId={companyId} jobId={jobId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
