import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowRightIcon, MagnifyingGlassIcon, SignInIcon, WarningIcon } from '@phosphor-icons/react'

import { HUNT_PORTALS, HUNT_WINDOW_NAMES, HUNT_WINDOWS, PORTAL_NAMES, PORTALS } from '../../../shared/types'
import type { HuntWindow, Portal, Preferences } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { duration, when } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Group, Hidden, Loading, Page, RunStatusBadge, Tip } from '../ui/common'
import { Segments } from '../ui/fields'
import { Alert, AlertContent, AlertDescription, AlertIcon, Button, Checkbox, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/nx'

/** LinkedIn's searches: each target role, remote, and hybrid and on-site in each city. */
function searchCount(prefs: Preferences): number {
  const places = prefs.cities.length || 1
  const perRole = (prefs.modes.remote ? 1 : 0) + places * ((prefs.modes.hybrid ? 1 : 0) + (prefs.modes.onsite ? 1 : 0))
  return prefs.targetRoles.length * perRole
}

function source(portal: Portal, prefs: Preferences): string {
  if (portal === 'linkedin') {
    const n = searchCount(prefs)
    return `${n} ${n === 1 ? 'search' : 'searches'} from your target roles and places`
  }
  return portal === 'wellfound' ? 'The search saved on your Wellfound account' : 'The jobs Instahyre recommends for you'
}

/** The hunt, before it starts: which portals, how recent, then the last few hunts. */
export function HuntStart(): JSX.Element {
  const status = useAppStatus()
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const hunts = useData(() => api.runs.page({ flow: 'hunt', portal: 'all', page: 0 }), [], ['runs'])
  const [portals, setPortals] = useState<Portal[]>([])
  const [window, setWindow] = useState<HuntWindow>('day')

  useEffect(() => {
    if (!settings.data) return
    setPortals(PORTALS.filter(portal => settings.data!.portals[portal].enabled && HUNT_PORTALS.includes(portal)))
    setWindow(settings.data.preferences.window)
  }, [settings.data])

  const prefs = settings.data?.preferences
  if (!settings.data || !prefs) return <Page title="Hunt"><Loading /></Page>

  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const signedOut = (portal: Portal): boolean => sites.data?.find(site => site.site === portal)?.state === 'signed-out'
  const usable = (portal: Portal): boolean => settings.data!.portals[portal].enabled && HUNT_PORTALS.includes(portal)
  const picked = portals.filter(usable)
  const problem = prefs.targetRoles.length === 0 ? 'Add the roles you want in Settings, Preferences.' : status?.claude.state !== 'ok' && status?.claude.state !== 'checking' ? 'Claude Code needs attention: see Settings, Accounts.' : null

  const start = async (): Promise<void> => {
    if (await attempt(() => api.flows.hunt({ portals: picked, window }))) go('/run')
  }

  return (
    <Page
      title="Hunt"
      actions={
        <Button variant="ghost" size="sm" endIcon={<ArrowRightIcon />} onClick={() => go('/settings/preferences')}>
          Preferences
        </Button>
      }
    >
      <div className="nx:max-w-[680px] nx:flex nx:flex-col nx:gap-8">
        {problem && (
          <Alert variant="warning" layout="inline">
            <AlertIcon>
              <WarningIcon />
            </AlertIcon>
            <AlertContent>
              <AlertDescription>{problem}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
        <div className="nx:flex nx:flex-col nx:gap-2">
          <div className="nx:flex nx:items-center nx:gap-1">
            <span className="nx:typography-label-default">Portals</span>
            <Tip text="Each portal runs in its own session, all at once." />
          </div>
          <div className="nx:rounded-md nx:border-default nx:border-border-default">
            {PORTALS.map((portal, i) => {
              const out = signedOut(portal)
              const on = usable(portal)
              return (
                <div key={portal} className={`nx:flex nx:items-center nx:gap-3 nx:px-4 nx:py-3 ${i < PORTALS.length - 1 ? 'nx:border-b-default nx:border-border-default' : ''}`}>
                  <Checkbox
                    id={`hunt-${portal}`}
                    aria-label={`Hunt on ${PORTAL_NAMES[portal]}`}
                    disabled={!on}
                    checked={on && portals.includes(portal)}
                    onCheckedChange={value => setPortals(current => (value === true ? [...current, portal] : current.filter(one => one !== portal)))}
                  />
                  <label htmlFor={`hunt-${portal}`} className={`nx:flex nx:flex-col nx:flex-1 nx:min-w-0 ${on ? 'nx:cursor-pointer' : ''}`}>
                    <span className={`nx:typography-label-default ${on ? '' : 'nx:text-muted-foreground'}`}>{PORTAL_NAMES[portal]}</span>
                    <span className="nx:typography-body-small nx:text-muted-foreground">{on ? source(portal, prefs) : 'Off in Settings'}</span>
                  </label>
                  {!on ? (
                    <Button variant="ghost" size="sm" onClick={() => go(`/settings/portals`)}>
                      Turn on
                    </Button>
                  ) : out ? (
                    <Button variant="outline" size="sm" startIcon={<SignInIcon />} onClick={() => void attempt(() => api.chrome.signIn(portal))}>
                      Sign in
                    </Button>
                  ) : (
                    <span className="nx:typography-body-small nx:text-muted-foreground">Signed in</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="nx:flex nx:flex-col nx:gap-2">
          <span className="nx:typography-label-default">Posted in</span>
          <div>
            <Segments value={window} ariaLabel="Posted in" options={HUNT_WINDOWS.map(one => ({ value: one, label: HUNT_WINDOW_NAMES[one] }))} onChange={value => setWindow(value as HuntWindow)} />
          </div>
        </div>
        <div className="nx:flex nx:items-center nx:gap-3">
          <Button startIcon={<MagnifyingGlassIcon />} disabled={isBusy || picked.length === 0 || !!problem} onClick={() => void start()}>
            Start hunt
          </Button>
          <span className="nx:typography-body-small nx:text-muted-foreground">
            {isBusy ? 'Another run is going.' : picked.length ? `${picked.length} ${picked.length === 1 ? 'session' : 'sessions'}, all at once` : 'Pick a portal.'}
          </span>
        </div>

        <Group
          title="Recent hunts"
          action={
            <Button variant="ghost" size="sm" onClick={() => go('/runs')}>
              Run history
            </Button>
          }
        >
          {hunts.data && hunts.data.rows.length > 0 ? (
            <Table aria-label="Recent hunts" density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Found</TableHead>
                  <TableHead>Took</TableHead>
                  <TableHead>
                    <Hidden>Status</Hidden>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hunts.data.rows.slice(0, 5).map(run => (
                  <TableRow key={run.id} className="nx:cursor-pointer" onClick={() => go(`/runs/${run.id}`)}>
                    <TableCell className="nx:typography-label-default nx:whitespace-nowrap">{when(run.started)}</TableCell>
                    <TableCell className="nx:typography-body-small">{run.result ?? ''}</TableCell>
                    <TableCell className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{run.usage.ms ? duration(run.usage.ms) : ''}</TableCell>
                    <TableCell className="nx:text-end">
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <span className="nx:typography-body-small nx:text-muted-foreground">No hunts yet.</span>
          )}
        </Group>
      </div>
    </Page>
  )
}
