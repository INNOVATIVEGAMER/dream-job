import { useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  BrowserIcon,
  BriefcaseIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  FileArrowUpIcon,
  FileJsIcon,
  FilePdfIcon,
  LinkedinLogoIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  RocketIcon,
  RocketLaunchIcon,
  SignInIcon,
  TerminalWindowIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react'

import { GMAIL_PLAYBOOK, PLAYBOOKS } from '../../../../shared/playbooks'
import { yearsOfExperience } from '../../../../shared/profile'
import { EMAIL_COUNTS, GMAIL_TOOLS, isSignInSite, PORTAL_NAMES, PORTAL_TOOL_GROUP_NAMES, PORTAL_TOOLS, PORTALS, SIGN_IN_SITES, SITE_NAMES } from '../../../../shared/types'
import type { EmailCount, EmailSettings, FormAnswer, Portal, PortalSetting, Preferences, Profile, Settings as SettingsValue, SignInSite, SiteState } from '../../../../shared/types'
import { api } from '../../lib/api'
import { useAutosaved } from '../../lib/autosave'
import { useData } from '../../lib/data'
import { day, when } from '../../lib/format'
import { go } from '../../lib/router'
import { useAppStatus } from '../../lib/status'
import { attempt, ErrorNote, Group, Hidden, Loading, Page, Tip } from '../../ui/common'
import { End, ListBox, ListRow, Rows, Segments, Tags } from '../../ui/fields'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '../../ui/nx'
import { PreferencesForm } from './PreferencesForm'
import { linkRows, ProjectsList, RolesList } from './ProfileParts'

type Key = 'profile' | 'resume' | 'answers' | 'preferences' | 'message' | 'accounts' | Portal | 'gmail'

const NAV: { group: string; items: { key: Key; label: string; to: string }[] }[] = [
  {
    group: 'You',
    items: [
      { key: 'profile', label: 'Profile', to: '/settings/profile' },
      { key: 'resume', label: 'Resume', to: '/settings/resume' },
      { key: 'answers', label: 'Form answers', to: '/settings/answers' },
    ],
  },
  {
    group: 'Search',
    items: [
      { key: 'preferences', label: 'Preferences', to: '/settings/preferences' },
      { key: 'message', label: 'Referral message', to: '/settings/message' },
    ],
  },
  {
    group: 'Connections',
    items: [
      { key: 'accounts', label: 'Accounts', to: '/settings/accounts' },
      ...PORTALS.map(portal => ({ key: portal as Key, label: PORTAL_NAMES[portal], to: `/settings/portals/${portal}` })),
      { key: 'gmail', label: 'Gmail', to: '/settings/portals/gmail' },
    ],
  },
]

const isPortal = (value: string | undefined): value is Portal => (PORTALS as readonly string[]).includes(value ?? '')

/** The section a route names: `/settings/<tab>/<sub>`, with portals and Gmail under `portals`. */
function keyOf(tab: string, sub?: string): Key {
  if (tab === 'portals') return sub === 'gmail' ? 'gmail' : isPortal(sub) ? sub : 'linkedin'
  return NAV.flatMap(group => group.items).some(item => item.key === tab) ? (tab as Key) : 'preferences'
}

function SettingsNav({ active }: { active: Key }): JSX.Element {
  return (
    <nav aria-label="Settings" className="nx:flex nx:flex-col nx:gap-0.5 nx:w-[200px] nx:shrink-0 nx:sticky nx:top-0">
      {NAV.map(group => (
        <div key={group.group} className="nx:flex nx:flex-col nx:gap-0.5">
          <span className="nx:typography-label-caps nx:text-muted-foreground nx:px-2 nx:pt-3 nx:pb-1">{group.group}</span>
          {group.items.map(item => (
            <button
              key={item.key}
              type="button"
              aria-current={item.key === active ? 'page' : undefined}
              className={`nx:block nx:w-full nx:text-left nx:px-2 nx:py-1 nx:rounded-sm nx:border-0 nx:cursor-pointer nx:typography-body-small nx:text-foreground ${item.key === active ? 'nx:bg-muted' : 'nx:bg-transparent nx:hover:bg-muted'}`}
              onClick={() => go(item.to)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

/** A section's title, with a short status beside it and an action on the right. */
function Head({ title, meta, tip, action }: { title: string; meta?: ReactNode; tip?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="nx:flex nx:items-center nx:justify-between nx:gap-3 nx:min-h-9">
      <div className="nx:flex nx:items-center nx:gap-2 nx:min-w-0">
        <h1 className="nx:typography-heading-medium nx:m-0">{title}</h1>
        {tip && <Tip text={tip} />}
        {meta}
      </div>
      {action}
    </div>
  )
}

const switchRow = (props: { id: string; label: string; tip?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }): { label: string; id: string; tip?: string; control: JSX.Element } => ({
  label: props.label,
  id: props.id,
  tip: props.tip,
  control: (
    <End>
      <Switch id={props.id} checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
    </End>
  ),
})

/* ------------------------------------------------------------------ */
/* You                                                                 */
/* ------------------------------------------------------------------ */

function ProfileSection({ settings }: { settings: SettingsValue }): JSX.Element {
  const [profile, setProfile] = useAutosaved(settings.profile, value => api.settings.setProfile(value))
  const [found, setFound] = useState<Profile | null>(null)
  const [isReading, setIsReading] = useState(false)
  const set = (patch: Partial<Profile>): void => setProfile(current => ({ ...current, ...patch }))

  const readResume = async (): Promise<void> => {
    if (!settings.resume && !(await attempt(() => api.settings.chooseResume()))) return
    setIsReading(true)
    const result = await attempt(() => api.settings.importResume())
    setIsReading(false)
    if (result) setFound(result.profile)
  }

  return (
    <>
      <Head
        title="Profile"
        tip="Every written answer and the hunt's scoring draw on this and nothing else"
        action={
          <Button variant="outline" size="sm" startIcon={<FileArrowUpIcon />} loading={isReading} onClick={() => void readResume()}>
            {isReading ? 'Claude is reading it' : 'Update from your resume'}
          </Button>
        }
      />
      <Rows
        items={[
          { label: 'Name', id: 'profile-name', control: <Input id="profile-name" value={profile.name} onChange={event => set({ name: event.target.value })} /> },
          { label: 'Headline', id: 'profile-headline', control: <Input id="profile-headline" value={profile.headline} onChange={event => set({ headline: event.target.value })} /> },
          {
            label: 'Lives in',
            id: 'profile-location',
            control: <Input id="profile-location" placeholder="City, country" value={profile.location} onChange={event => set({ location: event.target.value })} />,
          },
        ]}
      />
      <RolesList roles={profile.roles} skills={profile.skills} onChange={roles => set({ roles })} />
      <ProjectsList projects={profile.projects} onChange={projects => set({ projects })} />
      <Rows
        title="More"
        items={[
          { label: 'Skills', id: 'profile-skills', control: <Tags id="profile-skills" ariaLabel="Skills" values={profile.skills} onChange={skills => set({ skills })} placeholder="Add a skill" /> },
          ...linkRows(profile.links, links => set({ links })),
          {
            label: 'Never mention',
            id: 'profile-never',
            tip: 'Claude never writes these into a form or a message, and never links them',
            control: <Textarea id="profile-never" rows={2} placeholder="One per line" value={profile.never} onChange={event => set({ never: event.target.value })} />,
          },
        ]}
      />
      {found && (
        <Dialog open onOpenChange={open => !open && setFound(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Claude read your resume</DialogTitle>
              <DialogDescription>
                {found.roles.length} roles, {found.projects.length} projects and {found.skills.length} skills. Your name, headline and city stay unless you have none.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ListBox label="Roles found">
                {found.roles.map(role => (
                  <ListRow key={role.id} title={role.title} detail={role.company} />
                ))}
              </ListBox>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFound(null)}>
                Keep mine
              </Button>
              <Button
                onClick={() => {
                  setProfile(current => ({
                    ...current,
                    name: current.name || found.name,
                    headline: current.headline || found.headline,
                    location: current.location || found.location,
                    roles: found.roles,
                    projects: found.projects,
                    skills: found.skills,
                    links: found.links,
                  }))
                  setFound(null)
                }}
              >
                Use these
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

const TWO_MB = 2 * 1024 * 1024

function ResumeSection({ settings }: { settings: SettingsValue }): JSX.Element {
  const resume = settings.resume
  const choose = (): Promise<unknown> => attempt(() => api.settings.chooseResume(), 'Resume saved')
  return (
    <>
      <Head title="Resume" tip="Uploaded with every application, and attached to referral messages if you choose" />
      {resume ? (
        <Attachment>
          <AttachmentMedia variant="icon">
            <FilePdfIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{resume.fileName}</AttachmentTitle>
            <AttachmentDescription>
              {[resume.pages ? `${resume.pages} ${resume.pages === 1 ? 'page' : 'pages'}` : null, `${Math.round(resume.bytes / 1024)} KB`, `added ${day(resume.addedAt)}`].filter(Boolean).join(' · ')}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <Button variant="ghost" size="sm" endIcon={<ArrowSquareOutIcon />} onClick={() => void attempt(() => api.settings.openResume())}>
              Open
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void choose()}>
              Replace
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Remove the resume" onClick={() => void attempt(() => api.settings.removeResume(), 'Resume removed')}>
              <TrashIcon />
            </Button>
          </AttachmentActions>
        </Attachment>
      ) : (
        <div className="nx:flex nx:flex-col nx:items-center nx:gap-3 nx:p-8 nx:rounded-md nx:text-center" style={{ border: '1px dashed var(--nx-color-border-default)' }}>
          <UploadSimpleIcon size={24} />
          <span className="nx:typography-label-default">Add your resume</span>
          <Button variant="outline" size="sm" onClick={() => void choose()}>
            Choose a PDF
          </Button>
        </div>
      )}
      {resume && resume.bytes > TWO_MB && (
        <Alert variant="warning" layout="inline">
          <AlertIcon>
            <WarningIcon />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>Over 2 MB. Some forms refuse it.</AlertDescription>
          </AlertContent>
        </Alert>
      )}
      <Rows
        items={[
          switchRow({
            id: 'resume-referral',
            label: 'Attach to referral messages',
            checked: settings.referral.attachResume,
            onChange: attachResume => void attempt(() => api.settings.setReferral({ ...settings.referral, attachResume })),
          }),
        ]}
      />
    </>
  )
}

function AnswerRow({ answer }: { answer: FormAnswer }): JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    if (text === null) return
    if (text.trim() && text.trim() !== answer.answer) await attempt(() => api.settings.saveAnswer(answer.question, text))
    setText(null)
  }
  return (
    <TableRow className="nx:group">
      <TableCell className="nx:typography-label-default">{answer.question}</TableCell>
      <TableCell className="nx:typography-body-small">
        {text === null ? (
          answer.answer
        ) : (
          <Input
            aria-label={`Answer to ${answer.question}`}
            value={text}
            autoFocus
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void save()
              if (event.key === 'Escape') setText(null)
            }}
          />
        )}
      </TableCell>
      <TableCell className="nx:text-end nx:whitespace-nowrap">
        {text === null ? (
          <div className="nx:flex nx:justify-end nx:gap-1 nx:opacity-0 nx:group-hover:opacity-100 nx:focus-within:opacity-100 nx:transition-opacity">
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${answer.question}`} onClick={() => setText(answer.answer)}>
              <PencilSimpleIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${answer.question}`} onClick={() => void attempt(() => api.settings.removeAnswer(answer.id))}>
              <TrashIcon />
            </Button>
          </div>
        ) : (
          <div className="nx:flex nx:justify-end nx:gap-1">
            <Button size="sm" onClick={() => void save()}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setText(null)}>
              Cancel
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

function AddAnswer({ onClose }: { onClose: () => void }): JSX.Element {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const add = async (): Promise<void> => {
    await attempt(() => api.settings.saveAnswer(question, answer), 'Answer saved')
    onClose()
  }
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add answer</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="answer-question">Question</FieldLabel>
              <Input id="answer-question" placeholder="Notice period" value={question} autoFocus onChange={event => setQuestion(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="answer-text">Answer</FieldLabel>
              <Input id="answer-text" value={answer} onChange={event => setAnswer(event.target.value)} />
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!question.trim() || !answer.trim()} onClick={() => void add()}>
            Add answer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AnswersSection(): JSX.Element {
  const answers = useData(() => api.settings.answers(), [], ['answers'])
  const [search, setSearch] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const shown = (answers.data ?? []).filter(one => `${one.question} ${one.answer}`.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <>
      <Head
        title="Form answers"
        tip="Facts forms ask for, learned once and reused. A form that asks something new stops and asks you, then saves the answer here."
        action={
          <Button variant="outline" size="sm" startIcon={<PlusIcon />} onClick={() => setIsAdding(true)}>
            Add answer
          </Button>
        }
      />
      <div className="nx:flex nx:items-center nx:gap-3">
        <InputGroup className="nx:max-w-[280px]">
          <InputGroupAddon align="inline-start">
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput type="search" aria-label="Search answers" placeholder="Search answers" value={search} onChange={event => setSearch(event.target.value)} />
        </InputGroup>
        {answers.data && <span className="nx:typography-body-small nx:text-muted-foreground">{answers.data.length} saved</span>}
      </div>
      {answers.error && <ErrorNote text={answers.error} />}
      {!answers.data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <span className="nx:typography-body-small nx:text-muted-foreground">{search ? 'Nothing matches.' : 'No answers yet. Forms save them here as they ask.'}</span>
      ) : (
        <Table aria-label="Saved answers" density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>Question</TableHead>
              <TableHead>Answer</TableHead>
              <TableHead>
                <Hidden>Actions</Hidden>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(one => (
              <AnswerRow key={`${one.id}-${one.updated}-${one.answer}`} answer={one} />
            ))}
          </TableBody>
        </Table>
      )}
      {isAdding && <AddAnswer onClose={() => setIsAdding(false)} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const isPreferencesValid = (value: Preferences): boolean =>
  (value.ceilingYears === null || (Number.isInteger(value.ceilingYears) && value.ceilingYears >= 0 && value.ceilingYears <= 60)) && (value.floor === null || value.floor > 0)

function PreferencesSection({ settings }: { settings: SettingsValue }): JSX.Element {
  const [prefs, setPrefs] = useAutosaved(settings.preferences, value => api.settings.setPreferences(value), { isValid: isPreferencesValid })
  return (
    <>
      <Head title="Preferences" tip="What the hunt searches for and scores against. The kind of company is never a cut." />
      <PreferencesForm value={prefs} onChange={setPrefs} years={yearsOfExperience(settings.profile)} />
    </>
  )
}

const SLOTS = ['{name}', '{role}', '{company}', '{job link}'] as const

/** The main process refuses anything in braces but the four slots. */
const isTemplateValid = (template: string): boolean => (template.match(/\{[^}]*\}/g) ?? []).every(slot => (SLOTS as readonly string[]).includes(slot))

function MessageSection({ settings }: { settings: SettingsValue }): JSX.Element {
  const status = useAppStatus()
  const referral = settings.referral
  const [template, setTemplate] = useAutosaved(referral.template, value => api.settings.setReferral({ ...referral, template: value }), { isValid: isTemplateValid })
  const box = useRef<HTMLTextAreaElement>(null)
  const isSending = status?.run?.flow === 'referral' && (status.run.status === 'running' || status.run.status === 'waiting')

  const insert = (slot: string): void => {
    const el = box.current
    const at = el ? el.selectionStart : template.length
    const end = el ? el.selectionEnd : at
    setTemplate(template.slice(0, at) + slot + template.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + slot.length, at + slot.length)
    })
  }
  const preview = template.replace(/\{name\}|\{role\}|\{company\}|\{job link\}/g, slot => `[${slot.slice(1, -1)}]`)

  return (
    <>
      <Head title="Referral message" tip="Your approved wording. A change here approves the new wording for every later message." />
      <div className="nx:flex nx:flex-col nx:gap-3">
        <Textarea
          ref={box}
          rows={8}
          aria-label="Your referral message"
          readOnly={isSending}
          placeholder="Hi {name}, I applied for the {role} role at {company}..."
          value={template}
          onChange={event => setTemplate(event.target.value)}
        />
        {!isTemplateValid(template) && (
          <span className="nx:typography-body-small nx:text-error-subtle-foreground">Only the four slots below can be in braces. Not saved until then.</span>
        )}
        {isSending && <span className="nx:typography-body-small nx:text-muted-foreground">Locked while referral messages are going out.</span>}
        <div className="nx:flex nx:flex-wrap nx:items-center nx:gap-2">
          <span className="nx:typography-body-small nx:text-muted-foreground">Insert</span>
          {SLOTS.map(slot => (
            <Button key={slot} variant="outline" size="sm" disabled={isSending} onClick={() => insert(slot)}>
              {slot}
            </Button>
          ))}
        </div>
      </div>
      <Rows
        items={[
          switchRow({
            id: 'message-resume',
            label: 'Attach your resume',
            checked: referral.attachResume,
            onChange: attachResume => void attempt(() => api.settings.setReferral({ ...referral, template: isTemplateValid(template) ? template : referral.template, attachResume })),
          }),
        ]}
      />
      <Group title="Preview">
        <div className="nx:rounded-md nx:bg-muted nx:p-4 nx:typography-body-small nx:whitespace-pre-wrap">{preview || 'Nothing yet.'}</div>
        <span className="nx:typography-body-small nx:text-muted-foreground">Sent word for word. Only the slots change for each person.</span>
      </Group>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

const SITE_ICON: Record<SignInSite, JSX.Element> = {
  google: <EnvelopeIcon size={18} />,
  linkedin: <LinkedinLogoIcon size={18} />,
  wellfound: <RocketIcon size={18} />,
  instahyre: <BriefcaseIcon size={18} />,
  jsgurujobs: <FileJsIcon size={18} />,
  workatastartup: <RocketLaunchIcon size={18} />,
  weekday: <CalendarBlankIcon size={18} />,
}

function StateMark({ ok }: { ok: boolean }): JSX.Element {
  return ok ? <CheckCircleIcon size={16} className="nx:text-success-subtle-foreground" /> : <WarningIcon size={16} className="nx:text-warning-subtle-foreground" />
}

const signInText = (site: SiteState | undefined): string =>
  site?.state === 'signed-in' ? `Signed in${site.checked ? `, checked ${when(site.checked)}` : ''}` : site?.state === 'signed-out' ? 'Signed out' : 'Not checked yet'

function AccountsSection(): JSX.Element {
  const status = useAppStatus()
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const info = useData(() => api.chrome.info(), [], [])
  const claude = status?.claude
  const browser = status?.browser
  const isClaudeReady = claude?.state === 'ok' || claude?.state === 'api-key' || claude?.state === 'other-provider'

  return (
    <>
      <Head title="Accounts" tip="Signing in is always yours: the app opens the page in its Chrome and you type. Claude never types a password or a code." />
      <ListBox label="Accounts">
        <ListRow
          media={<TerminalWindowIcon size={18} />}
          title="Claude Code"
          detail={claude?.message ?? 'Checking'}
          actions={
            <>
              {claude && claude.state !== 'checking' && <StateMark ok={isClaudeReady} />}
              {claude && !isClaudeReady && claude.state !== 'checking' && <Tip text="Signed out? Run claude auth login in a terminal, then check again." />}
              <Button variant="ghost" size="sm" startIcon={<ArrowsClockwiseIcon />} onClick={() => void attempt(() => api.checkClaude())}>
                Check again
              </Button>
            </>
          }
        />
        <ListRow
          media={<BrowserIcon size={18} />}
          title="Chrome"
          detail={
            browser?.error ??
            (info.data && !info.data.chromePath
              ? 'Not found: install Google Chrome'
              : browser?.mode === 'controlled'
                ? "The app's own profile, controlled by the app"
                : browser?.mode === 'signin'
                  ? 'Open for signing in, with no control link'
                  : 'Closed')
          }
          actions={
            browser?.mode === 'closed' || !browser ? (
              <>
                <Button variant="outline" size="sm" startIcon={<SignInIcon />} onClick={() => void attempt(() => api.chrome.open('signin'))}>
                  Open to sign in
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void attempt(() => api.chrome.open('controlled'))}>
                  Open controlled
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" startIcon={<XIcon />} onClick={() => void attempt(() => api.chrome.close())}>
                Close Chrome
              </Button>
            )
          }
        />
        {SIGN_IN_SITES.map(name => {
          const site = sites.data?.find(one => one.site === name)
          const isOut = site?.state !== 'signed-in'
          return (
            <ListRow
              key={name}
              media={SITE_ICON[name]}
              title={name === 'google' ? 'Google, for Gmail' : SITE_NAMES[name]}
              detail={signInText(site)}
              actions={
                <>
                  {site && site.state !== 'unknown' && <StateMark ok={!isOut} />}
                  <Button variant={isOut ? 'outline' : 'ghost'} size="sm" startIcon={isOut ? <SignInIcon /> : undefined} onClick={() => void attempt(() => api.chrome.signIn(name))}>
                    {isOut ? 'Sign in' : 'Open'}
                  </Button>
                </>
              }
            />
          )
        })}
      </ListBox>
      {info.data && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">Chrome profile: {info.data.profileDir}</span>}
    </>
  )
}

/** The notes Claude gets for a site, folded away. */
function Playbook({ name, lines }: { name: string; lines: readonly string[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" endIcon={open ? <CaretUpIcon /> : <CaretDownIcon />}>
          Playbook: {lines.length} notes Claude gets for {name}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="nx:mt-2 nx:mb-0 nx:py-3 nx:pr-3 nx:pl-8 nx:rounded-md nx:bg-muted nx:typography-body-small nx:flex nx:flex-col nx:gap-2">
          {lines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function PortalSection({ settings, portal }: { settings: SettingsValue; portal: Portal }): JSX.Element {
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const site = sites.data?.find(one => one.site === portal)
  const name = PORTAL_NAMES[portal]
  const setting = settings.portals[portal]
  const save = (next: PortalSetting): void => void attempt(() => api.settings.setPortals({ ...settings.portals, [portal]: next }))
  const tools = PORTAL_TOOLS[portal]
  const groups = [...new Set(tools.map(tool => tool.group))]

  return (
    <>
      <Head
        title={name}
        meta={<span className="nx:typography-body-small nx:text-muted-foreground">{isSignInSite(portal) ? signInText(site) : 'No account needed'}</span>}
        action={
          isSignInSite(portal) && site?.state !== 'signed-in' ? (
            <Button variant="outline" size="sm" startIcon={<SignInIcon />} onClick={() => void attempt(() => api.chrome.signIn(portal))}>
              Sign in
            </Button>
          ) : undefined
        }
      />
      <Rows
        items={[
          switchRow({
            id: `use-${portal}`,
            label: `Use ${name}`,
            tip: 'Off: hunts, applies and the referral track skip it',
            checked: setting.enabled,
            onChange: enabled => save({ ...setting, enabled }),
          }),
        ]}
      />
      {groups.map(group => (
        <Rows
          key={group}
          title={PORTAL_TOOL_GROUP_NAMES[group]}
          items={tools
            .filter(tool => tool.group === group)
            .map(tool =>
              switchRow({
                id: `tool-${portal}-${tool.name}`,
                label: tool.label,
                tip: [tool.detail, tool.asksFirst].filter(Boolean).join('. '),
                checked: setting.tools[tool.name] !== false,
                disabled: !setting.enabled,
                onChange: on => save({ ...setting, tools: { ...setting.tools, [tool.name]: on } }),
              }),
            )}
        />
      ))}
      <Rows
        items={[
          switchRow({
            id: `free-${portal}`,
            label: 'Free browsing',
            tip: `Open, read, click and type on ${name} pages the tools above don't cover. Off: only the tools above.`,
            checked: setting.freeBrowsing,
            disabled: !setting.enabled,
            onChange: freeBrowsing => save({ ...setting, freeBrowsing }),
          }),
        ]}
      />
      <Playbook name={name} lines={PLAYBOOKS[portal]} />
    </>
  )
}

function GmailSection({ settings }: { settings: SettingsValue }): JSX.Element {
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const google = sites.data?.find(site => site.site === 'google')
  const email = settings.email
  const save = (next: EmailSettings): void => void attempt(() => api.settings.setEmail(next))

  return (
    <>
      <Head
        title="Gmail"
        meta={<span className="nx:typography-body-small nx:text-muted-foreground">{google ? `Google: ${signInText(google).toLowerCase()}` : ''}</span>}
        action={
          google?.state !== 'signed-in' ? (
            <Button variant="outline" size="sm" startIcon={<SignInIcon />} onClick={() => void attempt(() => api.chrome.signIn('google'))}>
              Sign in
            </Button>
          ) : undefined
        }
      />
      <Rows
        items={[
          switchRow({
            id: 'use-gmail',
            label: 'Use Gmail',
            tip: 'For the email check. Reads only: never replies, sends, deletes, archives or labels.',
            checked: email.enabled,
            onChange: enabled => save({ ...email, enabled }),
          }),
          {
            label: 'Emails to read',
            tip: 'Your newest, from every inbox tab except Promotions. Emails an earlier check read are skipped.',
            control: (
              <End>
                <Segments
                  ariaLabel="Emails to read"
                  value={String(email.count)}
                  disabled={!email.enabled}
                  options={EMAIL_COUNTS.map(count => ({ value: String(count), label: String(count) }))}
                  onChange={count => save({ ...email, count: Number(count) as EmailCount })}
                />
              </End>
            ),
          },
          switchRow({
            id: 'gmail-on-open',
            label: 'Check when the app opens',
            tip: 'At most once a day',
            checked: email.checkOnOpen,
            disabled: !email.enabled,
            onChange: checkOnOpen => save({ ...email, checkOnOpen }),
          }),
        ]}
      />
      <Rows
        title="Tools"
        items={GMAIL_TOOLS.map(tool =>
          switchRow({
            id: `tool-gmail-${tool.name}`,
            label: tool.label,
            tip: `${tool.detail}. Off: the email check can't run.`,
            checked: email.tools[tool.name] !== false,
            disabled: !email.enabled,
            onChange: on => save({ ...email, tools: { ...email.tools, [tool.name]: on } }),
          }),
        )}
      />
      <Rows
        items={[
          switchRow({
            id: 'free-gmail',
            label: 'Free browsing',
            tip: "Open, read and click Gmail pages the tools above don't cover. Off: only the tools above.",
            checked: email.freeBrowsing,
            disabled: !email.enabled,
            onChange: freeBrowsing => save({ ...email, freeBrowsing }),
          }),
        ]}
      />
      <Playbook name="Gmail" lines={GMAIL_PLAYBOOK} />
    </>
  )
}

function Section({ active, settings }: { active: Key; settings: SettingsValue }): JSX.Element {
  switch (active) {
    case 'profile':
      return <ProfileSection settings={settings} />
    case 'resume':
      return <ResumeSection settings={settings} />
    case 'answers':
      return <AnswersSection />
    case 'message':
      return <MessageSection settings={settings} />
    case 'accounts':
      return <AccountsSection />
    case 'gmail':
      return <GmailSection settings={settings} />
    case 'preferences':
      return <PreferencesSection settings={settings} />
    default:
      return <PortalSection settings={settings} portal={active} />
  }
}

/** Settings: a section list on the left, one section on the right. Everything saves as it changes. */
export function Settings({ tab, sub }: { tab: string; sub?: string }): JSX.Element {
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const active = keyOf(tab, sub)

  return (
    <Page title="Settings" meta="Changes save as you go" layout="bare">
      <div className="nx:flex nx:items-start nx:gap-10 nx:px-10 nx:py-8">
        <SettingsNav active={active} />
        <div className="nx:flex nx:flex-col nx:gap-6 nx:flex-1 nx:min-w-0 nx:max-w-[720px]">
          {settings.error && <ErrorNote text={settings.error} />}
          {settings.data ? <Section key={active} active={active} settings={settings.data} /> : <Loading />}
        </div>
      </div>
    </Page>
  )
}
