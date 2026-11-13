import type { JSX } from 'react'

import { GMAIL_PLAYBOOK } from '../../../../shared/playbooks'
import { EMAIL_COUNTS, GMAIL_TOOLS } from '../../../../shared/types'
import type { EmailCount, EmailSettings, Settings } from '../../../../shared/types'
import { api } from '../../lib/api'
import { useData } from '../../lib/data'
import { when } from '../../lib/format'
import { attempt } from '../../ui/common'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  NativeSelect,
  NativeSelectOption,
  Separator,
  Switch,
} from '../../ui/nx'

function ToolRow(props: { label: string; code?: string; detail: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }): JSX.Element {
  return (
    <div className="nx:flex nx:items-center nx:justify-between nx:gap-3">
      <div className="nx:flex nx:flex-col nx:gap-1">
        <span className="nx:typography-label-default">{props.label}</span>
        <span className="nx:typography-body-small nx:text-muted-foreground">
          {props.code && <code className="nx:typography-code-inline">{props.code}</code>} {props.detail}
        </span>
      </div>
      <Switch aria-label={props.label} checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
    </div>
  )
}

/** Settings, Portals, Gmail: how the email check reads mail, and what Claude may do there. */
export function GmailSettings({ settings }: { settings: Settings }): JSX.Element {
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const email = settings.email
  const save = (next: EmailSettings): void => void attempt(() => api.settings.setEmail(next))
  const google = sites.data?.find(site => site.site === 'google')

  return (
    <div className="nx:flex nx:flex-col nx:gap-5 nx:min-w-0" style={{ flex: '999 1 560px' }}>
      <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-3">
        <div className="nx:flex nx:flex-col nx:gap-1">
          <h2 className="nx:typography-heading-medium nx:m-0">Gmail</h2>
          <span className="nx:typography-body-small nx:text-muted-foreground">
            {google?.state === 'signed-in'
              ? `Signed in to Google in the app's Chrome. Checked ${when(google.checked)}.`
              : google?.state === 'signed-out'
                ? 'Google is signed out in the app\'s Chrome. Sign in from Accounts.'
                : 'Uses the Google account signed in to the app\'s Chrome.'}
          </span>
        </div>
        <Field orientation="horizontal">
          <Switch id="use-gmail" checked={email.enabled} onCheckedChange={enabled => save({ ...email, enabled })} />
          <FieldLabel htmlFor="use-gmail">Use Gmail</FieldLabel>
        </Field>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How it checks</CardTitle>
          <CardDescription>Status changes are saved straight away and listed when the check ends, each with its email. A job not in your tracker waits for you.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="gmail-count">Emails to read</FieldLabel>
              <NativeSelect id="gmail-count" value={String(email.count)} disabled={!email.enabled} onChange={event => save({ ...email, count: Number(event.target.value) as EmailCount })}>
                {EMAIL_COUNTS.map(count => (
                  <NativeSelectOption key={count} value={String(count)}>
                    Your newest {count}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>Claude sees the sender and subject of each, and opens the ones about your job search. Emails an earlier check read are skipped.</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch id="gmail-on-open" checked={email.checkOnOpen} disabled={!email.enabled} onCheckedChange={checkOnOpen => save({ ...email, checkOnOpen })} />
              <FieldLabel htmlFor="gmail-on-open">Check when the app opens, at most once a day</FieldLabel>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What Claude may do here</CardTitle>
          <CardDescription>Read only. Nothing here can reply, send, forward, draft, delete, archive, label or star mail. Turn a tool off and the email check can't run.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="nx:flex nx:flex-col nx:gap-5">
            <div className="nx:flex nx:flex-col nx:gap-3">
              <span className="nx:typography-label-caps nx:text-muted-foreground">Read mail</span>
              {GMAIL_TOOLS.map(tool => (
                <ToolRow
                  key={tool.name}
                  label={tool.label}
                  code={tool.name}
                  detail={tool.detail}
                  checked={email.tools[tool.name] !== false}
                  disabled={!email.enabled}
                  onChange={on => save({ ...email, tools: { ...email.tools, [tool.name]: on } })}
                />
              ))}
            </div>
            <Separator />
            <div className="nx:flex nx:flex-col nx:gap-3">
              <span className="nx:typography-label-caps nx:text-muted-foreground">Anything else</span>
              <ToolRow
                label="Free browsing in Gmail"
                detail="Open, read and click on Gmail pages the tools above don't cover. Off: Claude uses only the tools above."
                checked={email.freeBrowsing}
                disabled={!email.enabled}
                onChange={freeBrowsing => save({ ...email, freeBrowsing })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Playbook</CardTitle>
          <CardDescription>The short notes Claude gets for Gmail, beyond what the tools do. Part of the app, updated with each release.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="nx:typography-body-small nx:m-0 nx:py-3 nx:pr-3 nx:pl-8 nx:rounded-md nx:bg-muted nx:flex nx:flex-col nx:gap-2">
            {GMAIL_PLAYBOOK.map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
