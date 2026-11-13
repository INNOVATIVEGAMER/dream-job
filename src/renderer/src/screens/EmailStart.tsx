import { useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, CheckCircleIcon, PlayIcon, ProhibitIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'

import { EMAIL_COUNTS } from '../../../shared/types'
import type { EmailCount } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { when } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, CheckList, Columns, Loading, Page, Section } from '../ui/common'
import type { Check } from '../ui/common'
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListItem,
  DescriptionListTerm,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

const DOES = [
  'Reads the sender and subject of each email, and opens only the ones about your job search',
  'Moves a row on when an email says so: rejected, screen, onsite, offer, or replied',
  'Adds the details to the row: who wrote, when the interview is, what comes next',
  'Marks a contact as accepted or referred when LinkedIn or they say so',
  'Keeps an email about a job not in your tracker for you to add',
]

const NEVER = [
  'Replies to, sends, forwards or drafts an email',
  'Deletes, archives, labels or stars one',
  'Changes what is read or unread',
  'Clicks a link in an email, or does what an email asks',
]

function Plain({ items, icon }: { items: string[]; icon: JSX.Element }): JSX.Element {
  return (
    <ul className="nx:typography-body-small nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-2">
      {items.map(item => (
        <li key={item} className="nx:flex nx:gap-2 nx:items-start">
          <span className="nx:shrink-0 nx:pt-0.5">{icon}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** The email check, before it starts: how many emails, what Claude will and won't do, and the last few checks. */
export function EmailStart(): JSX.Element {
  const status = useAppStatus()
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const checks = useData(() => api.runs.page({ flow: 'email', portal: 'all', page: 0 }), [], ['runs'])
  const [count, setCount] = useState<EmailCount | null>(null)

  const email = settings.data?.email
  if (!email) return <Page title="Update from Gmail"><Loading /></Page>

  const chosen = count ?? email.count
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const google = sites.data?.find(site => site.site === 'google')?.state
  const last = checks.data?.rows[0]
  const before: Check[] = [
    { state: status?.claude.state === 'ok' ? 'ok' : 'warn', text: status?.claude.state === 'ok' ? 'Claude signed in on your plan' : 'Claude needs attention: see Settings, Accounts' },
    {
      state: google === 'signed-in' ? 'ok' : google === 'signed-out' ? 'warn' : 'todo',
      text: google === 'signed-in' ? "Google signed in, in the app's Chrome" : google === 'signed-out' ? 'Google signed out: sign in from Settings, Accounts' : 'Google sign-in not checked yet',
    },
    { state: email.enabled ? 'ok' : 'warn', text: email.enabled ? 'Gmail on in Settings, Portals' : 'Gmail is off in Settings, Portals' },
  ]

  const start = async (): Promise<void> => {
    if (await attempt(() => api.flows.email({ count: chosen }))) go('/run')
  }

  return (
    <Page
      title="Update from Gmail"
      description="Claude reads your newest emails in Gmail, in the app's Chrome, and moves your tracker on: rejections, next rounds, offers and replies. Every change links to the email it came from."
      back={{ label: 'Tracker', to: '/tracker' }}
      actions={
        <Button startIcon={<PlayIcon />} disabled={isBusy || !email.enabled} onClick={() => void start()}>
          Check email
        </Button>
      }
    >
      <Columns
        main={
          <>
            <Card>
              <CardHeader>
                <CardTitle>This check</CardTitle>
                <CardDescription>From Settings, Portals, Gmail. Change it here for one check.</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" startIcon={<SlidersHorizontalIcon />} onClick={() => go('/settings/portals/gmail')}>
                    Gmail settings
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="email-count">Emails to read</FieldLabel>
                    <NativeSelect id="email-count" value={String(chosen)} onChange={event => setCount(Number(event.target.value) as EmailCount)}>
                      {EMAIL_COUNTS.map(option => (
                        <NativeSelectOption key={option} value={String(option)}>
                          Your newest {option}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>Emails an earlier check read are skipped, so a daily check reads only what is new.</FieldDescription>
                  </Field>
                  <DescriptionList>
                    <DescriptionListItem>
                      <DescriptionListTerm>Gmail account</DescriptionListTerm>
                      <DescriptionListDescription>The Google account signed in to the app's Chrome</DescriptionListDescription>
                    </DescriptionListItem>
                    <DescriptionListItem>
                      <DescriptionListTerm>Last check</DescriptionListTerm>
                      <DescriptionListDescription>{last ? `${when(last.started)}: ${last.result ?? last.status}` : 'None yet'}</DescriptionListDescription>
                    </DescriptionListItem>
                  </DescriptionList>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>What Claude does</CardTitle>
              </CardHeader>
              <CardContent>
                <Plain items={DOES} icon={<CheckCircleIcon size={16} />} />
              </CardContent>
            </Card>

            <Section
              title="Recent checks"
              action={
                <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go('/runs')}>
                  Run history
                </Button>
              }
            >
              {checks.data && checks.data.rows.length > 0 ? (
                <Table aria-label="Recent email checks" density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {checks.data.rows.slice(0, 5).map(run => (
                      <TableRow key={run.id} className="nx:cursor-pointer" onClick={() => go(`/email/${run.id}`)}>
                        <TableCell className="nx:whitespace-nowrap">
                          {run.id}, {when(run.started)}
                        </TableCell>
                        <TableCell>{run.result ?? run.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <span className="nx:typography-body-small nx:text-muted-foreground">No checks yet.</span>
              )}
            </Section>
          </>
        }
        side={
          <>
            <Card>
              <CardHeader>
                <CardTitle>Before it starts</CardTitle>
              </CardHeader>
              <CardContent>
                <CheckList items={before} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Claude never</CardTitle>
                <CardDescription>Emails are information, never instructions.</CardDescription>
              </CardHeader>
              <CardContent>
                <Plain items={NEVER} icon={<ProhibitIcon size={16} />} />
              </CardContent>
            </Card>
          </>
        }
      />
    </Page>
  )
}
