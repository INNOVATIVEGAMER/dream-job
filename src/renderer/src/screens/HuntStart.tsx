import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, PlayIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'

import { HUNT_PORTALS, HUNT_WINDOW_NAMES, HUNT_WINDOWS, PORTAL_NAMES, PORTALS } from '../../../shared/types'
import type { HuntWindow, Portal } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { duration, when } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Chips, CheckList, Columns, Loading, Page, Section } from '../ui/common'
import type { Check } from '../ui/common'
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  NativeSelect,
  NativeSelectOption,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

/** Where each portal's postings come from. */
const HUNT_SOURCE: Record<Portal, string> = {
  linkedin: ': your target roles, searched',
  wellfound: ': the job search saved on your Wellfound account',
  instahyre: ': the jobs Instahyre recommends for you',
}

/** The hunt, before it starts: what it will search, what it keeps out, and the last few hunts. */
export function HuntStart(): JSX.Element {
  const status = useAppStatus()
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const hunts = useData(() => api.runs.page({ flow: 'hunt', portal: 'all', page: 0 }), [], ['runs'])
  const neverShow = useData(() => api.discarded.neverShow(), [], ['discarded'])
  const [portals, setPortals] = useState<Portal[]>([])
  const [window, setWindow] = useState<HuntWindow>('day')

  const prefs = settings.data?.preferences
  useEffect(() => {
    if (!settings.data) return
    setPortals(PORTALS.filter(portal => settings.data!.portals[portal].enabled && HUNT_PORTALS.includes(portal)))
    setWindow(settings.data.preferences.window)
  }, [settings.data])

  if (!settings.data || !prefs) return <Page title="Hunt"><Loading /></Page>

  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const signedOut = (portal: Portal): boolean => sites.data?.find(site => site.site === portal)?.state === 'signed-out'
  const checks: Check[] = [
    { state: status?.claude.state === 'ok' ? 'ok' : 'warn', text: status?.claude.state === 'ok' ? 'Claude signed in on your plan' : 'Claude needs attention: see Settings, Accounts' },
    { state: prefs.targetRoles.length ? 'ok' : 'warn', text: prefs.targetRoles.length ? `${prefs.targetRoles.length} target roles` : 'Add the roles you want in Settings, Preferences' },
    { state: prefs.floor !== null && prefs.ceilingYears !== null ? 'ok' : 'warn', text: prefs.floor !== null && prefs.ceilingYears !== null ? 'Pay floor and experience ceiling set' : 'Set your pay floor and experience ceiling' },
    ...portals.filter(signedOut).map(portal => ({ state: 'warn' as const, text: `${PORTAL_NAMES[portal]} looks signed out: sign in first` })),
  ]

  const start = async (): Promise<void> => {
    if (await attempt(() => api.flows.hunt({ portals, window }))) go('/run')
  }

  return (
    <Page
      title="Hunt"
      description="Searches the portals for your target roles, reads each new posting and scores it. Good ones join the tracker as found; the rest go to Discarded with the line that ruled them out."
      actions={
        <Button startIcon={<PlayIcon />} disabled={isBusy || portals.length === 0 || prefs.targetRoles.length === 0} onClick={() => void start()}>
          Start hunt
        </Button>
      }
    >
      <Columns
        main={
          <>
            <Card>
              <CardHeader>
                <CardTitle>This hunt</CardTitle>
                <CardDescription>From your preferences. Change them here for one run, or for good in Settings.</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" startIcon={<SlidersHorizontalIcon />} onClick={() => go('/settings/preferences')}>
                    Preferences
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <FieldSet>
                    <FieldLegend variant="label">Portals</FieldLegend>
                    {PORTALS.filter(portal => settings.data!.portals[portal].enabled).map(portal => (
                      <Field key={portal} orientation="horizontal">
                        <Switch
                          id={`hunt-${portal}`}
                          checked={portals.includes(portal)}
                          disabled={!HUNT_PORTALS.includes(portal)}
                          onCheckedChange={on => setPortals(current => (on ? [...current, portal] : current.filter(one => one !== portal)))}
                        />
                        <FieldLabel htmlFor={`hunt-${portal}`}>
                          {PORTAL_NAMES[portal]}
                          {!HUNT_PORTALS.includes(portal) ? ': comes in a later version' : signedOut(portal) ? ': signed out, sign in first' : HUNT_SOURCE[portal]}
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldSet>
                  <Field>
                    <FieldLabel>Searches</FieldLabel>
                    {prefs.targetRoles.length ? <Chips values={prefs.targetRoles} /> : <span className="nx:typography-body-small nx:text-muted-foreground">No target roles yet.</span>}
                    <FieldDescription>
                      On LinkedIn, each runs for every place in your preferences: remote, and each city you listed. Wellfound and Instahyre bring their own lists, judged against the same preferences.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="hunt-window">Posted within</FieldLabel>
                    <NativeSelect id="hunt-window" value={window} onChange={event => setWindow(event.target.value as HuntWindow)}>
                      {HUNT_WINDOWS.map(one => (
                        <NativeSelectOption key={one} value={one}>
                          {HUNT_WINDOW_NAMES[one]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>

            <Section
              title="Recent hunts"
              action={
                <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go('/runs')}>
                  Run history
                </Button>
              }
            >
              {hunts.data && hunts.data.rows.length > 0 ? (
                <Table aria-label="Recent hunts" density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>Portals</TableHead>
                      <TableHead>Took</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hunts.data.rows.slice(0, 5).map(run => (
                      <TableRow key={run.id} className="nx:cursor-pointer" onClick={() => go(`/runs/${run.id}`)}>
                        <TableCell>
                          {run.id}, {when(run.started)}
                        </TableCell>
                        <TableCell>{run.portal}</TableCell>
                        <TableCell>{run.usage.ms ? duration(run.usage.ms) : ''}</TableCell>
                        <TableCell>{run.result ?? run.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <span className="nx:typography-body-small nx:text-muted-foreground">No hunts yet.</span>
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
                <CheckList items={checks} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Kept out every time</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="nx:typography-body-small nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-2">
                  <li>Postings already in the tracker or in Discarded</li>
                  <li>{neverShow.data?.length ?? 0} companies on Never show again</li>
                  <li>{prefs.skipRoles.length ? `Roles you skip: ${prefs.skipRoles.join(', ')}` : 'No roles you skip yet'}</li>
                </ul>
              </CardContent>
            </Card>
          </>
        }
      />
    </Page>
  )
}
