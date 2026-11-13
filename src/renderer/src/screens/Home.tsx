import { useState } from 'react'
import type { JSX } from 'react'

import {
  ArrowRightIcon,
  BrowserIcon,
  ChatTextIcon,
  EnvelopeIcon,
  HandPalmIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlayIcon,
  SignInIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningIcon,
} from '@phosphor-icons/react'

import { PORTAL_NAMES, PORTALS } from '../../../shared/types'
import type { NeedsYou, Portal } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { portalName, when } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Columns, ErrorNote, Loading, Page, RunStatusBadge, Section, StatTile } from '../ui/common'
import {
  Button,
  Card,
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
  NativeSelect,
  NativeSelectOption,
  Separator,
} from '../ui/nx'

const NEED_ICONS: Record<NeedsYou['icon'], JSX.Element> = {
  'sign-in': <SignInIcon size={16} />,
  users: <UsersThreeIcon size={16} />,
  chat: <ChatTextIcon size={16} />,
  hand: <HandPalmIcon size={16} />,
  warning: <WarningIcon size={16} />,
}

const FLOW_ICONS = { hunt: <MagnifyingGlassIcon />, apply: <PaperPlaneTiltIcon />, connect: <UserPlusIcon />, referral: <UsersThreeIcon />, email: <EnvelopeIcon /> }

/** Home: the three flows, what needs the user, recent runs and the tracker's counts. */
export function Home(): JSX.Element {
  const status = useAppStatus()
  const home = useData(() => api.home(), [], ['opportunities', 'contacts', 'runs', 'settings', 'sites', 'email'])
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const [portal, setPortal] = useState<'all' | Portal>('all')

  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const enabled = PORTALS.filter(one => settings.data?.portals[one].enabled)
  const summary = home.data
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  const startHunt = async (): Promise<void> => {
    const portals = portal === 'all' ? enabled : [portal]
    const started = await attempt(() => api.flows.hunt({ portals, window: settings.data?.preferences.window ?? 'day' }))
    if (started) go('/run')
  }
  const checkEmail = async (): Promise<void> => {
    if (await attempt(() => api.flows.email({}))) go('/run')
  }
  const applyNext = async (): Promise<void> => {
    if (!summary?.nextFound) return
    const started = await attempt(() => api.flows.apply(summary.nextFound!.id))
    if (started) go('/run')
  }

  return (
    <Page
      meta={today}
      title="Today"
      description="Start a flow here. It runs in Chrome beside the app, shows on its own screen, and stops on a card when it needs you."
      actions={
        <Button variant="outline" startIcon={<BrowserIcon />} onClick={() => void attempt(() => (status?.browser.mode === 'closed' ? api.chrome.open('controlled') : api.chrome.front()))}>
          {status?.browser.mode === 'closed' ? 'Open Chrome' : 'Bring Chrome forward'}
        </Button>
      }
    >
      {home.error && <ErrorNote text={home.error} />}
      {!summary ? (
        <Loading />
      ) : (
        <Columns
          main={
            <>
              <Section title="Flows">
                {isBusy && <span className="nx:typography-body-small nx:text-muted-foreground">One flow runs at a time. These start when the current run ends.</span>}
                <div className="nx:flex nx:flex-wrap nx:gap-4">
                  <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 220px' }}>
                    <Card className="nx:w-full">
                      <CardHeader>
                        <CardTitle>Hunt</CardTitle>
                        <CardDescription>Search the portals for your target roles, score each new posting, and add the good ones as found.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="nx:flex nx:flex-col nx:gap-2">
                          <NativeSelect aria-label="Portals to hunt" size="sm" value={portal} onChange={event => setPortal(event.target.value as 'all' | Portal)}>
                            <NativeSelectOption value="all">{enabled.map(one => PORTAL_NAMES[one]).join(', ') || 'No portals on'}</NativeSelectOption>
                            {enabled.map(one => (
                              <NativeSelectOption key={one} value={one}>
                                {PORTAL_NAMES[one]} only
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          <span className="nx:typography-body-small nx:text-muted-foreground">
                            {summary.lastHunt ? `Last run ${when(summary.lastHunt.started)}: ${summary.lastHunt.result ?? summary.lastHunt.status}` : 'No hunt yet'}
                          </span>
                        </div>
                      </CardContent>
                      <CardFooter>
                        <Button startIcon={<PlayIcon />} disabled={isBusy || enabled.length === 0} onClick={() => void startHunt()}>
                          Start hunt
                        </Button>
                      </CardFooter>
                    </Card>
                  </div>
                  <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 220px' }}>
                    <Card className="nx:w-full">
                      <CardHeader>
                        <CardTitle>Apply</CardTitle>
                        <CardDescription>Work the found rows, best score first: check pay, fill the form from your answers, upload your resume.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="nx:flex nx:flex-col nx:gap-1">
                          <span className="nx:typography-heading-medium">{summary.foundCount} found</span>
                          <span className="nx:typography-body-small nx:text-muted-foreground">
                            {summary.nextFound
                              ? `Next: ${summary.nextFound.company}, ${summary.nextFound.role}${summary.nextFound.score ? ` (score ${summary.nextFound.score})` : ''}`
                              : 'Nothing found to apply to yet'}
                          </span>
                        </div>
                      </CardContent>
                      <CardFooter>
                        <div className="nx:flex nx:flex-wrap nx:gap-2">
                          <Button variant="secondary" startIcon={<PaperPlaneTiltIcon />} disabled={isBusy || !summary.nextFound} onClick={() => void applyNext()}>
                            Apply to next
                          </Button>
                          <Button variant="ghost" onClick={() => go('/tracker')}>
                            Pick a row
                          </Button>
                        </div>
                      </CardFooter>
                    </Card>
                  </div>
                  <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 220px' }}>
                    <Card className="nx:w-full">
                      <CardHeader>
                        <CardTitle>Referral track</CardTitle>
                        <CardDescription>Blank connection requests to people in your field at companies you applied to, then your approved message once they accept.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="nx:flex nx:flex-col nx:gap-1">
                          <span className="nx:typography-heading-medium">{summary.contactCounts.accepted} accepted</span>
                          <span className="nx:typography-body-small nx:text-muted-foreground">
                            {summary.contactCounts.pending} requests pending across {summary.pendingCompanies} companies
                          </span>
                        </div>
                      </CardContent>
                      <CardFooter>
                        <div className="nx:flex nx:flex-wrap nx:gap-2">
                          <Button variant="secondary" startIcon={<UserPlusIcon />} disabled={isBusy} onClick={() => go('/contacts/connect')}>
                            Send requests
                          </Button>
                          <Button variant="ghost" disabled={isBusy} onClick={() => go('/contacts/message')}>
                            Message accepted
                          </Button>
                        </div>
                      </CardFooter>
                    </Card>
                  </div>
                  <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 220px' }}>
                    <Card className="nx:w-full">
                      <CardHeader>
                        <CardTitle>Email</CardTitle>
                        <CardDescription>Read your newest emails in Gmail and move the tracker on: rejections, next rounds, offers and replies.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="nx:flex nx:flex-col nx:gap-1">
                          <span className="nx:typography-heading-medium">
                            {summary.email.waiting ? `${summary.email.waiting} waiting` : summary.email.lastChecked ? 'Up to date' : 'Not checked yet'}
                          </span>
                          <span className="nx:typography-body-small nx:text-muted-foreground">
                            {summary.email.lastChecked
                              ? `Last check ${when(summary.email.lastChecked)}: ${summary.email.moved} ${summary.email.moved === 1 ? 'row' : 'rows'} moved on`
                              : 'Claude reads only what is about your job search.'}
                          </span>
                        </div>
                      </CardContent>
                      <CardFooter>
                        <div className="nx:flex nx:flex-wrap nx:gap-2">
                          <Button variant="secondary" startIcon={<EnvelopeIcon />} disabled={isBusy || settings.data?.email.enabled === false} onClick={() => void checkEmail()}>
                            Check email
                          </Button>
                          {summary.email.lastRunId && (
                            <Button variant="ghost" onClick={() => go(`/email/${summary.email.lastRunId}`)}>
                              What changed
                            </Button>
                          )}
                        </div>
                      </CardFooter>
                    </Card>
                  </div>
                </div>
              </Section>

              <Section
                title="Recent runs"
                action={
                  <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go('/runs')}>
                    Run history
                  </Button>
                }
              >
                {summary.recentRuns.length === 0 ? (
                  <span className="nx:typography-body-small nx:text-muted-foreground">No runs yet. Start with a hunt.</span>
                ) : (
                  <ItemGroup>
                    {summary.recentRuns.map(run => (
                      <Item key={run.id} variant="outline" size="sm" asChild>
                        <button type="button" className="nx:cursor-pointer nx:text-left" onClick={() => go(`/runs/${run.id}`)}>
                          <ItemMedia variant="icon">{FLOW_ICONS[run.flow]}</ItemMedia>
                          <ItemContent>
                            <ItemTitle>{run.title}</ItemTitle>
                            <ItemDescription>
                              {[portalName(run.portal), run.result, when(run.started)].filter(Boolean).join('. ')}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <RunStatusBadge status={run.status} />
                          </ItemActions>
                        </button>
                      </Item>
                    ))}
                  </ItemGroup>
                )}
              </Section>
            </>
          }
          side={
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Needs you</CardTitle>
                  <CardDescription>{summary.needsYou.length ? 'Things only you can do.' : 'Nothing right now.'}</CardDescription>
                </CardHeader>
                {summary.needsYou.length > 0 && (
                  <CardContent>
                    <div className="nx:flex nx:flex-col nx:gap-4">
                      {summary.needsYou.map((need, i) => (
                        <div key={need.id} className="nx:flex nx:flex-col nx:gap-4">
                          {i > 0 && <Separator />}
                          <div className="nx:flex nx:flex-col nx:gap-2">
                            <div className="nx:flex nx:gap-2 nx:items-start">
                              {NEED_ICONS[need.icon]}
                              <div className="nx:flex nx:flex-col nx:gap-1">
                                <span className="nx:typography-label-default">{need.title}</span>
                                <span className="nx:typography-body-small nx:text-muted-foreground">{need.body}</span>
                              </div>
                            </div>
                            <div>
                              <Button variant="outline" size="sm" onClick={() => go(need.action.to.replace(/^#/, ''))}>
                                {need.action.label}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
              <Section title="Tracker">
                <div className="nx:grid nx:gap-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                  <StatTile value={summary.counts['found'] ?? 0} label="Found" onClick={() => go('/tracker')} />
                  <StatTile value={summary.counts['applied'] ?? 0} label="Applied" onClick={() => go('/tracker')} />
                  <StatTile value={summary.counts['replied'] ?? 0} label="Replied" onClick={() => go('/tracker')} />
                  <StatTile value={(summary.counts['screen'] ?? 0) + (summary.counts['onsite'] ?? 0)} label="Screen and onsite" onClick={() => go('/tracker')} />
                  <StatTile value={summary.counts['rejected'] ?? 0} label="Rejected" onClick={() => go('/tracker')} />
                  <StatTile value={summary.counts['dead'] ?? 0} label="Dead" onClick={() => go('/tracker')} />
                </div>
              </Section>
            </>
          }
        />
      )}
    </Page>
  )
}
