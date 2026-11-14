import type { JSX, ReactNode } from 'react'

import {
  ArchiveIcon,
  BriefcaseIcon,
  ClockCounterClockwiseIcon,
  GearIcon,
  HandPalmIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  TableIcon,
  WarningIcon,
} from '@phosphor-icons/react'

import type { AppStatus } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { CommandMenu } from './CommandMenu'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  Spinner,
} from './nx'

type NavItem = { to: string; label: string; icon: ReactNode; match: string; badge?: number }

function NavButton({ item, section }: { item: NavItem; section: string }): JSX.Element {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={section === item.match} onClick={() => go(item.to)}>
        {item.icon}
        <span>{item.label}</span>
      </SidebarMenuButton>
      {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  )
}

/** A run of several sessions in a few words: who waits for you and how many work. */
function lanesLine(run: NonNullable<AppStatus['run']>): string {
  const waiting = run.lanes.filter(lane => lane.status === 'waiting').length
  const working = run.lanes.filter(lane => lane.status === 'running').length
  const done = run.lanes.filter(lane => lane.status !== 'running' && lane.status !== 'waiting' && lane.status !== 'queued').length
  return [waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you` : '', working ? `${working} working` : '', `${done} of ${run.lanes.length} done`].filter(Boolean).join(', ')
}

/** The run going now, in the sidebar; no run, no group. */
function RunningNow({ status, section }: { status: AppStatus | null; section: string }): JSX.Element | null {
  const run = status?.run
  if (!run || (run.status !== 'running' && run.status !== 'waiting')) return null
  const line =
    run.lanes.length > 1
      ? lanesLine(run)
      : run.status === 'waiting'
        ? 'Needs you'
        : run.progress
          ? `${run.progress.label}, ${run.progress.done} of ${run.progress.total}`
          : 'Running'
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Running now</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" isActive={section === 'run'} onClick={() => go('/run')}>
              {run.status === 'waiting' ? <HandPalmIcon /> : <Spinner />}
              <div className="nx:flex nx:flex-col nx:min-w-0">
                <span className="nx:typography-label-default nx:truncate">{run.title}</span>
                <span className="nx:typography-body-small nx:text-nav-muted-foreground nx:truncate">{line}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Claude or Chrome needing attention: one line, only when something is wrong. */
function Problems({ status }: { status: AppStatus | null }): JSX.Element | null {
  const claude = status?.claude
  const claudeBad = claude && claude.state !== 'ok' && claude.state !== 'checking'
  const chromeBad = status?.browser.error
  if (!claudeBad && !chromeBad) return null
  return (
    <div className="nx:px-4 nx:pt-3">
      <Alert variant="warning" layout="inline">
        <AlertIcon>
          <WarningIcon />
        </AlertIcon>
        <AlertContent>
          <AlertDescription>{claudeBad ? (claude.message ?? 'Claude Code needs attention.') : chromeBad}</AlertDescription>
        </AlertContent>
        <Button variant="outline" size="sm" onClick={() => go('/settings/accounts')}>
          Open Accounts
        </Button>
      </Alert>
    </div>
  )
}

/** The app's frame: the sidebar, the command menu, and the screen. Each screen draws its own top bar. */
export function Shell({ section, children }: { section: string; children: ReactNode }): JSX.Element {
  const status = useAppStatus()
  const home = useData(() => api.home(), [], ['opportunities', 'contacts'])

  const main: NavItem[] = [
    { to: '/', label: 'Home', icon: <HouseIcon />, match: 'home' },
    { to: '/tracker', label: 'Tracker', icon: <TableIcon />, match: 'tracker', badge: home.data?.companyCount || undefined },
    { to: '/hunt', label: 'Hunt', icon: <MagnifyingGlassIcon />, match: 'hunt' },
  ]
  const records: NavItem[] = [
    { to: '/discarded', label: 'Discarded', icon: <ArchiveIcon />, match: 'discarded' },
    { to: '/runs', label: 'Run history', icon: <ClockCounterClockwiseIcon />, match: 'runs' },
  ]
  // A company, a job, its people, and the email check that moves jobs on all sit under Tracker.
  const navSection = ['opportunity', 'company', 'email', 'message'].includes(section) ? 'tracker' : section

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="nx:flex nx:items-center nx:gap-2 nx:px-2 nx:py-1">
            <span className="nx:inline-flex nx:items-center nx:justify-center nx:rounded-sm nx:bg-primary-background nx:text-primary-foreground" style={{ width: 24, height: 24 }}>
              <BriefcaseIcon size={14} />
            </span>
            <span className="nx:typography-label-default">Dream Job</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {main.map(item => (
                  <NavButton key={item.to} item={item} section={navSection} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Records</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {records.map(item => (
                  <NavButton key={item.to} item={item} section={navSection} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <RunningNow status={status} section={navSection} />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <NavButton item={{ to: '/settings', label: 'Settings', icon: <GearIcon />, match: 'settings' }} section={navSection} />
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <Problems status={status} />
        {children}
      </SidebarInset>
      <CommandMenu />
    </SidebarProvider>
  )
}
