import type { JSX, ReactNode } from 'react'

import {
  BrowserIcon,
  ChatCircleIcon,
  EnvelopeIcon,
  HandPalmIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  SignInIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningIcon,
} from '@phosphor-icons/react'

import type { NeedsYou } from '../../../shared/types'
import { api } from '../lib/api'
import { useData } from '../lib/data'
import { when } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { applyToNext, openCommandMenu } from '../ui/CommandMenu'
import { attempt, Group, Hidden, Loading, Page, RunStatusBadge } from '../ui/common'
import {
  Button,
  EmptyState,
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
  Kbd,
  KbdGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

const FLOW_ICON: Record<string, ReactNode> = {
  hunt: <MagnifyingGlassIcon size={14} />,
  apply: <PaperPlaneTiltIcon size={14} />,
  check: <ListChecksIcon size={14} />,
  connect: <UserPlusIcon size={14} />,
  referral: <ChatCircleIcon size={14} />,
  email: <EnvelopeIcon size={14} />,
}

const NEED_ICON: Record<NeedsYou['icon'], ReactNode> = {
  'sign-in': <SignInIcon className="nx:text-warning-subtle-foreground" />,
  users: <UsersThreeIcon className="nx:text-success-subtle-foreground" />,
  chat: <ChatCircleIcon className="nx:text-success-subtle-foreground" />,
  hand: <HandPalmIcon className="nx:text-warning-subtle-foreground" />,
  warning: <WarningIcon className="nx:text-warning-subtle-foreground" />,
}

function Quick({ label, icon, shortcut, onClick, disabled }: { label: string; icon: ReactNode; shortcut: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <Button variant="outline" size="sm" startIcon={icon} disabled={disabled} onClick={onClick}>
      {label}
      <Kbd className="nx:ml-1">{shortcut}</Kbd>
    </Button>
  )
}

function Row({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action: ReactNode }): JSX.Element {
  return (
    <div className="nx:flex nx:items-center nx:gap-3 nx:px-4 nx:py-3 nx:border-b-default nx:border-border-default nx:last:border-b-0">
      <span className="nx:inline-flex">{icon}</span>
      <div className="nx:flex nx:flex-col nx:flex-1 nx:min-w-0">
        <span className="nx:typography-label-default nx:truncate">{title}</span>
        <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{body}</span>
      </div>
      {action}
    </div>
  )
}

/** Home is an inbox: what needs you first, a few quick actions, then recent runs. */
export function Home(): JSX.Element {
  const status = useAppStatus()
  const home = useData(() => api.home(), [], ['opportunities', 'contacts', 'runs', 'settings', 'sites', 'email'])
  const summary = home.data
  const run = status?.run
  const isBusy = run?.status === 'running' || run?.status === 'waiting'

  if (!summary) return <Page title="Home"><Loading /></Page>

  const jobs = Object.values(summary.counts).reduce((sum, n) => sum + n, 0)
  const interviewing = (summary.counts['screen'] ?? 0) + (summary.counts['onsite'] ?? 0) + (summary.counts['offer'] ?? 0)
  const applied = (summary.counts['applied'] ?? 0) + (summary.counts['outreach'] ?? 0) + (summary.counts['replied'] ?? 0)

  const search = (
    <button
      type="button"
      onClick={openCommandMenu}
      className="nx:flex nx:items-center nx:gap-2 nx:w-full nx:px-3 nx:py-2 nx:rounded-md nx:border-default nx:border-border-default nx:bg-container nx:text-left nx:cursor-pointer"
    >
      <MagnifyingGlassIcon className="nx:text-muted-foreground" />
      <span className="nx:flex-1 nx:typography-body-default nx:text-muted-foreground">Search or run a command</span>
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </button>
  )

  const actions =
    status?.browser.mode === 'closed' ? (
      <Button variant="ghost" size="sm" startIcon={<BrowserIcon />} onClick={() => void attempt(() => api.chrome.open('controlled'))}>
        Open Chrome
      </Button>
    ) : undefined

  if (jobs === 0 && summary.recentRuns.length === 0) {
    return (
      <Page title="Home" narrow actions={actions}>
        {search}
        <EmptyState>
          <EmptyStateHeader>
            <EmptyStateMedia variant="icon">
              <MagnifyingGlassIcon />
            </EmptyStateMedia>
            <EmptyStateTitle>No jobs yet</EmptyStateTitle>
            <EmptyStateDescription>A hunt reads the portals and fills your tracker.</EmptyStateDescription>
          </EmptyStateHeader>
          <EmptyStateContent>
            <div className="nx:flex nx:gap-2">
              <Button startIcon={<MagnifyingGlassIcon />} onClick={() => go('/hunt')}>
                Start your first hunt
              </Button>
              <Button variant="outline" startIcon={<PlusIcon />} onClick={() => go('/tracker/new')}>
                Add a job
              </Button>
            </div>
          </EmptyStateContent>
        </EmptyState>
      </Page>
    )
  }

  const needs = [
    ...(run && run.status === 'waiting'
      ? [
          <Row
            key="run"
            icon={NEED_ICON.hand}
            title={`${run.title} needs you`}
            body={run.card?.kind === 'approve' ? 'Approve your answers' : 'A card is waiting'}
            action={
              <Button variant="outline" size="sm" onClick={() => go('/run')}>
                Review
              </Button>
            }
          />,
        ]
      : []),
    ...summary.needsYou.map(need => (
      <Row
        key={need.id}
        icon={NEED_ICON[need.icon]}
        title={need.title}
        body={need.body}
        action={
          <Button variant="outline" size="sm" onClick={() => go(need.action.to.replace(/^#/, ''))}>
            {need.action.label}
          </Button>
        }
      />
    )),
  ]

  const metric = (n: number, label: string, view: string): JSX.Element => (
    <button type="button" className="nx:flex nx:gap-1 nx:bg-transparent nx:border-0 nx:p-0 nx:cursor-pointer nx:typography-body-small nx:text-muted-foreground" onClick={() => go(`/tracker/${view}`)}>
      <span className="nx:typography-label-default nx:text-foreground">{n}</span>
      {label}
    </button>
  )

  return (
    <Page title="Home" narrow actions={actions}>
      <div className="nx:flex nx:flex-col nx:gap-3">
        {search}
        <div className="nx:flex nx:flex-wrap nx:gap-2">
          <Quick label="New hunt" icon={<MagnifyingGlassIcon />} shortcut="H" onClick={() => go('/hunt')} />
          <Quick label="Apply to next" icon={<PaperPlaneTiltIcon />} shortcut="A" disabled={isBusy || !summary.nextFound} onClick={() => void applyToNext()} />
          <Quick label="Check email" icon={<EnvelopeIcon />} shortcut="E" onClick={() => go('/email')} />
          <Quick label="Send requests" icon={<UserPlusIcon />} shortcut="R" onClick={() => go('/contacts/connect')} />
        </div>
      </div>

      <div className="nx:flex nx:flex-wrap nx:items-center nx:gap-2">
        {metric(summary.counts['found'] ?? 0, 'found to apply', 'found')}
        <span className="nx:text-muted-foreground">·</span>
        {metric(applied, 'applied', 'applied')}
        <span className="nx:text-muted-foreground">·</span>
        {metric(interviewing, 'interviewing', 'interviewing')}
        <span className="nx:text-muted-foreground">·</span>
        {metric(summary.counts['replied'] ?? 0, 'replied', 'applied')}
      </div>

      {needs.length > 0 && (
        <Group title={`Needs you ${needs.length}`}>
          <div className="nx:rounded-md nx:border-default nx:border-border-default nx:overflow-hidden">{needs}</div>
        </Group>
      )}

      <Group
        title="Recent runs"
        action={
          <Button variant="ghost" size="sm" onClick={() => go('/runs')}>
            Run history
          </Button>
        }
      >
        {summary.recentRuns.length === 0 ? (
          <span className="nx:typography-body-small nx:text-muted-foreground">No runs yet.</span>
        ) : (
          <Table aria-label="Recent runs" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Hidden>Run</Hidden>
                </TableHead>
                <TableHead>
                  <Hidden>Result</Hidden>
                </TableHead>
                <TableHead>
                  <Hidden>Status</Hidden>
                </TableHead>
                <TableHead>
                  <Hidden>When</Hidden>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.recentRuns.map(one => (
                <TableRow key={one.id} className="nx:cursor-pointer" onClick={() => go(`/runs/${one.id}`)}>
                  <TableCell>
                    <span className="nx:flex nx:items-center nx:gap-2">
                      <span className="nx:inline-flex nx:text-muted-foreground">{FLOW_ICON[one.flow]}</span>
                      <span className="nx:typography-label-default nx:whitespace-nowrap">{one.title}</span>
                    </span>
                  </TableCell>
                  <TableCell className="nx:typography-body-small nx:text-muted-foreground">
                    <span className="nx:line-clamp-1">{one.result ?? ''}</span>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={one.status} />
                  </TableCell>
                  <TableCell className="nx:text-end nx:typography-body-small nx:text-muted-foreground nx:whitespace-nowrap">{when(one.started)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Group>
    </Page>
  )
}
