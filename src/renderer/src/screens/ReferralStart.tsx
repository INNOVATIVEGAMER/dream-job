import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, ArrowsClockwiseIcon, PaperclipIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react'

import { api } from '../lib/api'
import { useData } from '../lib/data'
import { day } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, CheckList, Columns, Loading, Page } from '../ui/common'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Switch,
} from '../ui/nx'

/** Starts a referral-message run: check who accepted, pick companies, and see the message that goes out. */
export function ReferralStart(): JSX.Element {
  const status = useAppStatus()
  const ready = useData(() => api.contacts.ready(), [], ['contacts'])
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const [picked, setPicked] = useState<string[]>([])
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  useEffect(() => {
    if (ready.data) setPicked(ready.data.filter(company => company.isReady && company.opportunityId).map(company => company.company))
  }, [ready.data])

  if (!ready.data || !settings.data) return <Page title="Message accepted connections"><Loading /></Page>

  const template = settings.data.referral.template.trim()
  const people = ready.data.filter(company => picked.includes(company.company)).reduce((sum, company) => sum + company.accepted, 0)
  const send = async (): Promise<void> => {
    if (await attempt(() => api.flows.referral({ companies: picked }))) go('/run')
  }
  const check = async (): Promise<void> => {
    if (await attempt(() => api.flows.checkAccepted())) go('/run')
  }

  return (
    <Page
      back={{ label: 'Contacts', to: '/contacts' }}
      title="Message accepted connections"
      description="Your approved referral message, word for word, with your resume, to the people who accepted at the companies you pick."
      actions={
        <Button startIcon={<PaperPlaneTiltIcon />} disabled={isBusy || people === 0 || !template} onClick={() => void send()}>
          Send {people} {people === 1 ? 'message' : 'messages'}
        </Button>
      }
    >
      <Columns
        main={
          <>
            <Card>
              <CardHeader>
                <CardTitle>1. Who accepted</CardTitle>
                <CardDescription>The app reads your newest LinkedIn connections and moves anyone who accepted from pending to accepted.</CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm" startIcon={<ArrowsClockwiseIcon />} disabled={isBusy} onClick={() => void check()}>
                    Check now
                  </Button>
                </CardAction>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>2. Companies</CardTitle>
                <CardDescription>A company is ready once 3 have accepted, or once nobody there is still pending.</CardDescription>
              </CardHeader>
              <CardContent>
                {ready.data.length === 0 ? (
                  <span className="nx:typography-body-small nx:text-muted-foreground">Nobody has accepted yet. Check again later.</span>
                ) : (
                  <ItemGroup>
                    {ready.data.map(company => (
                      <Item key={company.company} size="sm">
                        <ItemMedia variant="icon">
                          <Switch
                            size="sm"
                            aria-label={`Include ${company.company}`}
                            disabled={!company.opportunityId}
                            checked={picked.includes(company.company)}
                            onCheckedChange={on => setPicked(current => (on ? [...current, company.company] : current.filter(one => one !== company.company)))}
                          />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>
                            {company.company}: {company.accepted} accepted{company.pending ? `, ${company.pending} pending` : ''}
                          </ItemTitle>
                          <ItemDescription>
                            {company.role ? `Points at ${company.role}, applied ${day(company.appliedOn)}` : 'No applied role here yet: apply first'}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Badge variant={company.isReady ? 'success' : 'secondary'} fill="light" isCaps={false}>
                            {company.isReady ? 'Ready' : 'Waits for a batch'}
                          </Badge>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                )}
              </CardContent>
            </Card>
          </>
        }
        side={
          <>
            <Card>
              <CardHeader>
                <CardTitle>3. The message</CardTitle>
                <CardDescription>Your saved wording. Only the four slots change for each person.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="nx:typography-body-small nx:p-3 nx:rounded-md nx:bg-muted nx:text-foreground nx:whitespace-pre-wrap">
                  {template || 'No message saved yet.'}
                </div>
              </CardContent>
              <CardFooter>
                <div className="nx:flex nx:flex-wrap nx:items-center nx:gap-2">
                  {settings.data.referral.attachResume && (
                    <Badge variant="secondary" fill="light" isCaps={false} leftIcon={<PaperclipIcon />}>
                      {settings.data.resume?.fileName ?? 'No resume yet'}
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go('/settings/message')}>
                    Edit in Settings
                  </Button>
                </div>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Before it starts</CardTitle>
              </CardHeader>
              <CardContent>
                <CheckList
                  items={[
                    { state: template ? 'ok' : 'warn', text: template ? 'Referral message saved' : 'Save your referral message in Settings' },
                    {
                      state: !settings.data.referral.attachResume || settings.data.resume ? 'ok' : 'warn',
                      text: !settings.data.referral.attachResume ? 'No resume attached, by your choice' : settings.data.resume ? 'Resume added' : 'Add your resume in Settings',
                    },
                    { state: picked.length ? 'ok' : 'todo', text: 'Each company picked has an applied role to point at' },
                  ]}
                />
              </CardContent>
            </Card>
          </>
        }
      />
    </Page>
  )
}
