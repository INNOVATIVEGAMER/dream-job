import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import {
  BuildingsIcon,
  ClockCounterClockwiseIcon,
  EnvelopeIcon,
  EyeSlashIcon,
  GearIcon,
  HouseIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  TableIcon,
  UserCheckIcon,
  UserPlusIcon,
} from '@phosphor-icons/react'

import { REQUESTS_PER_COMPANY } from '../../../shared/types'
import { api } from '../lib/api'
import { go } from '../lib/router'
import { attempt } from './common'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from './nx'

/** Checks jobs against their apply pages (every found and applied job when `ids` is empty), then shows the run. */
export async function checkPostings(ids: number[]): Promise<void> {
  if (await attempt(() => api.flows.checkPostings(ids))) go('/run')
}

/** Sends new blank connection requests at each company, up to the usual number each, then shows the run. Answers whether it started. */
export async function sendRequests(companyIds: number[]): Promise<boolean> {
  const runId = await attempt(() => api.flows.connect({ companyIds, perCompany: REQUESTS_PER_COMPANY }))
  if (runId) go('/run')
  return !!runId
}

/** Reads your newest LinkedIn connections and marks everyone who accepted a request, then shows the run. */
export async function checkAccepted(): Promise<void> {
  if (await attempt(() => api.flows.checkAccepted())) go('/run')
}

type Command = { key: string; label: string; icon: ReactNode; shortcut?: string; run: () => void }

const RUN: Command[] = [
  { key: 'hunt', label: 'Start a hunt', icon: <MagnifyingGlassIcon />, shortcut: 'H', run: () => go('/hunt') },
  { key: 'apply', label: 'Pick found jobs to apply to', icon: <PaperPlaneTiltIcon />, shortcut: 'A', run: () => go('/tracker/found') },
  { key: 'connect', label: 'Pick companies to send connection requests', icon: <UserPlusIcon />, shortcut: 'R', run: () => go('/tracker/applied') },
  { key: 'email', label: 'Check email', icon: <EnvelopeIcon />, shortcut: 'E', run: () => go('/email') },
  { key: 'check', label: 'Check postings of found and applied jobs', icon: <ListChecksIcon />, run: () => void checkPostings([]) },
  { key: 'accepted', label: 'Check who accepted your requests', icon: <UserCheckIcon />, run: () => void checkAccepted() },
]

const PAGES: Command[] = [
  { key: 'home', label: 'Go to Home', icon: <HouseIcon />, run: () => go('/') },
  { key: 'tracker', label: 'Go to Tracker', icon: <TableIcon />, run: () => go('/tracker') },
  { key: 'never-show', label: 'Go to Never show', icon: <EyeSlashIcon />, run: () => go('/never-show') },
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
