import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowSquareOutIcon, PaperPlaneTiltIcon, UserPlusIcon } from '@phosphor-icons/react'

import { STATUSES } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { capitalize, day, portalName, when } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Columns, ErrorNote, Loading, Page, StatusBadge } from '../ui/common'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListItem,
  DescriptionListTerm,
  Field,
  FieldDescription,
  FieldLabel,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '../ui/nx'

function Fact({ term, value }: { term: string; value: string | null | undefined }): JSX.Element | null {
  if (!value) return null
  return (
    <DescriptionListItem>
      <DescriptionListTerm>{term}</DescriptionListTerm>
      <DescriptionListDescription>{value}</DescriptionListDescription>
    </DescriptionListItem>
  )
}

/** One opportunity: the posting, why it scored, notes, status, referral path and history. */
export function Opportunity({ id }: { id: number }): JSX.Element {
  const status = useAppStatus()
  const detail = useData(() => api.tracker.get(id), [id], ['opportunities', 'contacts'])
  const [notes, setNotes] = useState('')
  const row = detail.data?.opportunity
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  useEffect(() => {
    if (row) setNotes(row.notes)
  }, [row?.id, row?.notes])

  if (detail.error) return <Page title="Opportunity"><ErrorNote text={detail.error} /></Page>
  if (!detail.data) return <Page title="Opportunity"><Loading /></Page>
  if (!row) return <Page title="Opportunity" back={{ label: 'Tracker', to: '/tracker' }}><ErrorNote text="This row is no longer in the tracker." /></Page>

  const contacts = detail.data.contacts
  const apply = async (): Promise<void> => {
    if (await attempt(() => api.flows.apply([row.id]))) go('/run')
  }

  return (
    <Page
      back={{ label: 'Tracker', to: '/tracker' }}
      meta={`${portalName(row.portal) || 'Added by you'}, found ${day(row.found)}`}
      title={row.company}
      badge={<StatusBadge status={row.status} />}
      description={row.role}
      actions={
        <>
          {row.link && (
            <Button variant="outline" startIcon={<ArrowSquareOutIcon />} onClick={() => void attempt(() => api.chrome.openUrl(row.link!))}>
              Open posting
            </Button>
          )}
          {row.status === 'found' && (
            <Button startIcon={<PaperPlaneTiltIcon />} disabled={isBusy} onClick={() => void apply()}>
              Apply
            </Button>
          )}
        </>
      }
    >
      <Columns
        main={
          <>
            <Card>
              <CardHeader>
                <CardTitle>Posting</CardTitle>
              </CardHeader>
              <CardContent>
                <DescriptionList>
                  <Fact term="Stage" value={capitalize(row.stage)} />
                  <Fact term="Work mode" value={row.mode} />
                  <Fact term="Experience asked" value={row.experience} />
                  <Fact term="Pay" value={row.pay ?? 'Not shown'} />
                  <Fact term="Applicants" value={row.applicants} />
                  <Fact term="Posting" value={row.postingState ? `${capitalize(row.postingState)}${row.postingChecked ? `, checked ${when(row.postingChecked)}` : ''}` : null} />
                  <Fact term="Apply route" value={row.applyRoute} />
                </DescriptionList>
              </CardContent>
            </Card>
            {row.scoreReasons.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Why it scored {row.score}</CardTitle>
                  <CardDescription>Scored by the hunt against your preferences.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="nx:typography-body-default nx:m-0 nx:pl-5 nx:flex nx:flex-col nx:gap-2">
                    {row.scoreReasons.map(reason => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
                <CardDescription>Your own notes, and what each run recorded, such as what an application sent.</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea aria-label="Notes" rows={8} value={notes} onChange={event => setNotes(event.target.value)} />
              </CardContent>
              <CardFooter>
                <Button variant="secondary" size="sm" disabled={notes === row.notes} onClick={() => void attempt(() => api.tracker.setNotes(row.id, notes), 'Notes saved')}>
                  Save notes
                </Button>
              </CardFooter>
            </Card>
          </>
        }
        side={
          <>
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent>
                <Field>
                  <FieldLabel htmlFor="opp-status">Status</FieldLabel>
                  <NativeSelect id="opp-status" value={row.status} onChange={event => void attempt(() => api.tracker.setStatus(row.id, event.target.value), 'Status saved')}>
                    {STATUSES.map(one => (
                      <NativeSelectOption key={one} value={one}>
                        {capitalize(one)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription>Rejected closes the row. No follow-up is sent, and the company stays eligible.</FieldDescription>
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Referral path</CardTitle>
                <CardDescription>
                  {contacts.length === 0
                    ? `No contacts at ${row.company} yet. Connection requests are the next step.`
                    : `${contacts.length} ${contacts.length === 1 ? 'person' : 'people'} at ${row.company}.`}
                </CardDescription>
              </CardHeader>
              {contacts.length > 0 && (
                <CardContent>
                  <ul className="nx:typography-body-small nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-2">
                    {contacts.slice(0, 8).map(contact => (
                      <li key={contact.id} className="nx:flex nx:justify-between nx:gap-2">
                        <span>
                          {contact.name}, {contact.role}
                        </span>
                        <span className="nx:text-muted-foreground">{capitalize(contact.state)}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
              {row.status !== 'found' && (
                <CardFooter>
                  <Button variant="outline" size="sm" startIcon={<UserPlusIcon />} disabled={isBusy} onClick={() => go('/contacts/connect')}>
                    {contacts.length ? 'Send more requests' : 'Send connection requests'}
                  </Button>
                </CardFooter>
              )}
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-3">
                  {detail.data.events.map(event => (
                    <li key={event.id} className="nx:flex nx:flex-col nx:gap-1">
                      <span className="nx:typography-body-small">{event.text}</span>
                      <span className="nx:typography-body-small nx:text-muted-foreground">{when(event.at)}</span>
                    </li>
                  ))}
                  {detail.data.events.length === 0 && <span className="nx:typography-body-small nx:text-muted-foreground">Kept from before the app.</span>}
                </ol>
              </CardContent>
            </Card>
          </>
        }
      />
    </Page>
  )
}
