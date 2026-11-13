import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import {
  ArchiveIcon,
  BuildingsIcon,
  ChatCircleIcon,
  ClockCounterClockwiseIcon,
  EnvelopeIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  TableIcon,
  UserPlusIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'

import { api } from '../lib/api'
import { go } from '../lib/router'
import { attempt } from './common'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from './nx'

/** Starts an Apply run for the best-scored found job, then shows it. */
export async function applyToNext(): Promise<void> {
  const home = await attempt(() => api.home())
  if (!home?.nextFound) return void attempt(() => Promise.reject(new Error('Nothing is found and waiting to apply.')))
  if (await attempt(() => api.flows.apply([home.nextFound!.id]))) go('/run')
}

type Command = { key: string; label: string; icon: ReactNode; shortcut?: string; run: () => void }

const RUN: Command[] = [
  { key: 'hunt', label: 'Start a hunt', icon: <MagnifyingGlassIcon />, shortcut: 'H', run: () => go('/hunt') },
  { key: 'apply', label: 'Apply to next found', icon: <PaperPlaneTiltIcon />, shortcut: 'A', run: () => void applyToNext() },
  { key: 'email', label: 'Check email', icon: <EnvelopeIcon />, shortcut: 'E', run: () => go('/email') },
  { key: 'connect', label: 'Send connection requests', icon: <UserPlusIcon />, shortcut: 'R', run: () => go('/contacts/connect') },
  { key: 'message', label: 'Message accepted connections', icon: <ChatCircleIcon />, shortcut: 'M', run: () => go('/contacts/message') },
]

const PAGES: Command[] = [
  { key: 'home', label: 'Go to Home', icon: <HouseIcon />, run: () => go('/') },
  { key: 'tracker', label: 'Go to Tracker', icon: <TableIcon />, run: () => go('/tracker') },
  { key: 'contacts', label: 'Go to Contacts', icon: <UsersThreeIcon />, run: () => go('/contacts') },
  { key: 'discarded', label: 'Go to Discarded', icon: <ArchiveIcon />, run: () => go('/discarded') },
  { key: 'runs', label: 'Go to Run history', icon: <ClockCounterClockwiseIcon />, run: () => go('/runs') },
  { key: 'settings', label: 'Open Settings', icon: <GearIcon />, run: () => go('/settings') },
]

const OPEN_EVENT = 'jobapp:command-menu'

/** Opens the command menu from anywhere, such as the search field on Home. */
export function openCommandMenu(): void {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/** Typing in a field never triggers a one-key shortcut. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || !!element.closest('[role="dialog"], [role="listbox"], [role="menu"]')
}

/**
 * The command menu, from any screen with Cmd+K: run a flow, jump to a
 * company, or go to a page. Each flow also has a one-key shortcut.
 */
export function CommandMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(current => !current)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      const command = RUN.find(one => one.shortcut?.toLowerCase() === event.key.toLowerCase())
      if (command) {
        event.preventDefault()
        command.run()
      }
    }
    const onOpen = (): void => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) void api.companies.names().then(setCompanies).catch(() => undefined)
  }, [open])

  const pick = (run: () => void): void => {
    setOpen(false)
    run()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command menu">
      <CommandInput placeholder="Search or run a command" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Run">
          {RUN.map(command => (
            <CommandItem key={command.key} value={command.label} onSelect={() => pick(command.run)}>
              {command.icon}
              <span>{command.label}</span>
              {command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {PAGES.map(command => (
            <CommandItem key={command.key} value={command.label} onSelect={() => pick(command.run)}>
              {command.icon}
              <span>{command.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {companies.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Companies">
              {companies.map(company => (
                <CommandItem key={company.id} value={`company ${company.name}`} onSelect={() => pick(() => go(`/company/${company.id}`))}>
                  <BuildingsIcon />
                  <span>{company.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
