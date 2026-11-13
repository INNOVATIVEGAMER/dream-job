import type { JSX, ReactNode } from 'react'

import {
  ArchiveIcon,
  BriefcaseIcon,
  BrowserIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  GearIcon,
  HandPalmIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  TableIcon,
  UsersThreeIcon,
  WarningIcon,
} from '@phosphor-icons/react'

import type { AppStatus } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import {
  Badge,
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
  SidebarTrigger,
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

function RunningNow({ status, section }: { status: AppStatus | null; section: string }): JSX.Element {
  const run = status?.run
  const isBusy = run && (run.status === 'running' || run.status === 'waiting')
  if (!run || !isBusy) {
    return <p className="nx:typography-body-small nx:m-0 nx:px-2 nx:text-nav-muted-foreground">Nothing. Start a flow from Home.</p>
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" isActive={section === 'run'} onClick={() => go('/run')}>
          {run.status === 'waiting' ? <HandPalmIcon /> : <Spinner />}
          <div className="nx:flex nx:flex-col nx:min-w-0">
            <span className="nx:typography-label-default nx:truncate">{run.title}</span>
            <span className="nx:typography-body-small nx:text-nav-muted-foreground nx:truncate">
              {run.status === 'waiting' ? 'Waiting for you' : run.progress ? `${run.progress.label}, ${run.progress.done} of ${run.progress.total}` : 'Running'}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function StatusBadges({ status }: { status: AppStatus | null }): JSX.Element {
  const claude = status?.claude
  const browser = status?.browser
  const claudeOk = claude?.state === 'ok'
  const chromeLabel =
    browser?.mode === 'controlled' ? 'Chrome connected' : browser?.mode === 'signin' ? 'Chrome open to sign in' : 'Chrome closed'
  return (
    <>
      <Badge
        variant={claudeOk ? 'success' : claude?.state === 'checking' ? 'secondary' : 'warning'}
        fill="light"
        isCaps={false}
        leftIcon={claudeOk ? <CheckCircleIcon /> : claude?.state === 'checking' ? <Spinner /> : <WarningIcon />}
        title={claude?.message}
      >
        {claudeOk ? 'Claude signed in' : claude?.state === 'checking' ? 'Checking Claude' : 'Claude needs attention'}
      </Badge>
      <Badge
        variant={browser?.mode === 'controlled' ? 'information' : 'secondary'}
        fill="light"
        isCaps={false}
        leftIcon={<BrowserIcon />}
        title={browser?.error ?? undefined}
      >
        {chromeLabel}
      </Badge>
    </>
  )
}

const TITLES: Record<string, string> = {
  home: 'Home',
  tracker: 'Tracker',
  opportunity: 'Tracker',
  email: 'Tracker',
  hunt: 'Hunt',
  run: 'Running now',
  runs: 'Run history',
  contacts: 'Contacts',
  discarded: 'Discarded',
  settings: 'Settings',
}

/** The app's frame: the sidebar, the top bar with Claude and Chrome, and the screen. */
export function Shell({ section, name, children }: { section: string; name: string; children: ReactNode }): JSX.Element {
  const status = useAppStatus()
  const home = useData(() => api.home(), [], ['opportunities', 'contacts'])
  const total = home.data ? Object.values(home.data.counts).reduce((sum, n) => sum + n, 0) : undefined

  const search: NavItem[] = [
    { to: '/', label: 'Home', icon: <HouseIcon />, match: 'home' },
    { to: '/tracker', label: 'Tracker', icon: <TableIcon />, match: 'tracker', badge: total },
    { to: '/hunt', label: 'Hunt', icon: <MagnifyingGlassIcon />, match: 'hunt' },
    { to: '/contacts', label: 'Contacts', icon: <UsersThreeIcon />, match: 'contacts', badge: home.data?.contactCounts.accepted || undefined },
  ]
  const records: NavItem[] = [
    { to: '/discarded', label: 'Discarded', icon: <ArchiveIcon />, match: 'discarded' },
    { to: '/runs', label: 'Run history', icon: <ClockCounterClockwiseIcon />, match: 'runs' },
  ]
  // A row, and the email check that moves rows on, sit under Tracker.
  const navSection = section === 'opportunity' || section === 'email' ? 'tracker' : section

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="nx:flex nx:items-center nx:gap-2 nx:px-2 nx:py-1">
            <span className="nx:inline-flex nx:items-center nx:justify-center nx:rounded-md nx:bg-primary-background nx:text-primary-foreground" style={{ width: 28, height: 28 }}>
              <BriefcaseIcon />
            </span>
            <div className="nx:flex nx:flex-col nx:min-w-0">
              <span className="nx:typography-label-default">Job App</span>
              <span className="nx:typography-body-small nx:text-nav-muted-foreground nx:truncate">{name || 'Your job search'}</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Search</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {search.map(item => (
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
          <SidebarGroup>
            <SidebarGroupLabel>Running now</SidebarGroupLabel>
            <SidebarGroupContent>
              <RunningNow status={status} section={navSection} />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <NavButton item={{ to: '/settings', label: 'Settings', icon: <GearIcon />, match: 'settings' }} section={navSection} />
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="nx:flex nx:flex-wrap nx:items-center nx:gap-2 nx:px-6 nx:py-3 nx:border-b-default nx:border-border-default">
          <SidebarTrigger aria-label="Show or hide the sidebar" />
          <span className="nx:typography-label-default nx:flex-1">{TITLES[section] ?? 'Job App'}</span>
          <StatusBadges status={status} />
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
