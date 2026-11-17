import { useState } from 'react'
import type { JSX } from 'react'

import { AppWindowIcon, CaretDownIcon, PlugsConnectedIcon, PlugsIcon } from '@phosphor-icons/react'

import { api, messageOf } from '../lib/api'
import { useAppStatus } from '../lib/status'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Spinner, toast } from './nx'

type Tone = 'on' | 'wait' | 'off'

const TONE_COLOR: Record<Tone, string> = {
  on: 'var(--nx-color-success-background)',
  wait: 'var(--nx-color-warning-background)',
  off: 'var(--nx-color-muted-foreground)',
}

function Dot({ tone }: { tone: Tone }): JSX.Element {
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: TONE_COLOR[tone] }} />
}

/**
 * Chrome in the top bar of every screen: whether the app is connected to its
 * Chrome. Closed, one click connects; open, a menu shows it or lets it go.
 */
export function ChromeButton(): JSX.Element | null {
  const status = useAppStatus()
  const [busy, setBusy] = useState<string | null>(null)
  const browser = status?.browser
  if (!browser) return null

  const isRunUsingIt = status?.run?.status === 'running' || status?.run?.status === 'waiting'
  const act = async (label: string, work: () => Promise<void>, done?: string): Promise<void> => {
    setBusy(label)
    try {
      await work()
      if (done) toast.success(done)
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusy(null)
    }
  }
  const connect = (): Promise<void> => act('Connecting...', () => api.chrome.open('controlled'))

  if (busy) {
    return (
      <Button variant="ghost" size="sm" startIcon={<Spinner />} disabled>
        {busy}
      </Button>
    )
  }

  if (browser.mode === 'closed') {
    return (
      <Button variant="ghost" size="sm" startIcon={<Dot tone="off" />} title={browser.error ?? "Opens the app's Chrome and connects to it"} onClick={() => void connect()}>
        Connect Chrome
      </Button>
    )
  }

  const isControlled = browser.mode === 'controlled'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" startIcon={<Dot tone={isControlled ? 'on' : 'wait'} />} endIcon={<CaretDownIcon />}>
          {isControlled ? 'Chrome connected' : 'Chrome open to sign in'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="nx:max-w-[280px]">
        <p className="nx:m-0 nx:px-2 nx:py-1.5 nx:typography-body-small nx:text-muted-foreground">
          {isControlled
            ? isRunUsingIt
              ? 'A run is using it. Stop the run to disconnect.'
              : "The app's own Chrome, under the app's control."
            : 'Open with no control link, so you can sign in. Close it when you are done to connect.'}
        </p>
        <DropdownMenuSeparator />
        {isControlled ? (
          <>
            <DropdownMenuItem onSelect={() => void act('Showing Chrome...', () => api.chrome.front())}>
              <AppWindowIcon /> Show Chrome
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isRunUsingIt} onSelect={() => void act('Disconnecting...', () => api.chrome.close(), 'Chrome disconnected and closed')}>
              <PlugsIcon /> Disconnect
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={() =>
                void act('Connecting...', async () => {
                  await api.chrome.close()
                  await api.chrome.open('controlled')
                })
              }
            >
              <PlugsConnectedIcon /> Done signing in: connect
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void act('Closing...', () => api.chrome.close())}>
              <PlugsIcon /> Close Chrome
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
