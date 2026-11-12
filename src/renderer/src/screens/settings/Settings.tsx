import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import {
  ArrowsClockwiseIcon,
  BrowserIcon,
  CheckCircleIcon,
  EyeIcon,
  FilePdfIcon,
  HandPalmIcon,
  PencilSimpleIcon,
  PlusIcon,
  RobotIcon,
  ShieldCheckIcon,
  SignInIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react'

import { PLAYBOOKS } from '../../../../shared/playbooks'
import { PORTAL_NAMES, PORTAL_TOOL_GROUP_NAMES, PORTAL_TOOLS, PORTALS, SITE_NAMES } from '../../../../shared/types'
import type {
  FormAnswer,
  Portal,
  PortalSettings,
  Preferences,
  Profile,
  ReferralMessage,
  Settings as SettingsValue,
  SignInSite,
} from '../../../../shared/types'
import { api } from '../../lib/api'
import { useData } from '../../lib/data'
import { day, when } from '../../lib/format'
import { go } from '../../lib/router'
import { useAppStatus } from '../../lib/status'
import { attempt, CheckList, ChipsInput, ErrorNote, Hidden, Loading, Page } from '../../ui/common'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListItem,
  DescriptionListTerm,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Separator,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '../../ui/nx'
import { PreferencesForm } from './PreferencesForm'
import { LinksEditor, ProjectsList, RolesList } from './ProfileParts'

const TABS = [
  ['preferences', 'Preferences'],
  ['profile', 'Profile'],
  ['answers', 'Form answers'],
  ['resume', 'Resume'],
  ['message', 'Referral message'],
  ['portals', 'Portals'],
  ['accounts', 'Accounts'],
] as const

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function SaveBar({ isDirty, onSave, label }: { isDirty: boolean; onSave: () => void; label: string }): JSX.Element {
  return (
    <div className="nx:flex nx:items-center nx:gap-3 nx:pt-6">
      <Button disabled={!isDirty} onClick={onSave}>
        {label}
      </Button>
      {isDirty && <span className="nx:typography-body-small nx:text-muted-foreground">Unsaved changes</span>}
    </div>
  )
}

function PreferencesTab({ settings }: { settings: SettingsValue }): JSX.Element {
  const [prefs, setPrefs] = useState<Preferences>(settings.preferences)
  useEffect(() => setPrefs(settings.preferences), [settings.preferences])
  return (
    <div className="nx:pt-4">
      <PreferencesForm value={prefs} onChange={setPrefs} />
      <SaveBar isDirty={!same(prefs, settings.preferences)} label="Save preferences" onSave={() => void attempt(() => api.settings.setPreferences(prefs), 'Preferences saved')} />
    </div>
  )
}

function ProfileTab({ settings }: { settings: SettingsValue }): JSX.Element {
  const [profile, setProfile] = useState<Profile>(settings.profile)
  const [found, setFound] = useState<Profile | null>(null)
  const [isReading, setIsReading] = useState(false)
  useEffect(() => setProfile(settings.profile), [settings.profile])
  const set = (patch: Partial<Profile>): void => setProfile(current => ({ ...current, ...patch }))

  const readResume = async (): Promise<void> => {
    if (!settings.resume && !(await attempt(() => api.settings.chooseResume()))) return
    setIsReading(true)
    const result = await attempt(() => api.settings.importResume())
    setIsReading(false)
    if (result) setFound(result.profile)
  }

  return (
    <div className="nx:pt-4">
      <div className="nx:flex nx:flex-wrap nx:gap-6 nx:items-start">
        <div className="nx:flex nx:flex-col nx:gap-5 nx:min-w-0" style={{ flex: '999 1 560px' }}>
          <Card>
            <CardHeader>
              <CardTitle>About you</CardTitle>
              <CardDescription>The source of truth. Written answers and the hunt's scoring draw on this profile and nothing else.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="nx:flex nx:flex-wrap nx:gap-3">
                <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
                  <Field>
                    <FieldLabel htmlFor="profile-name">Name</FieldLabel>
                    <Input id="profile-name" value={profile.name} onChange={event => set({ name: event.target.value })} />
                  </Field>
                </div>
                <div className="nx:min-w-0" style={{ flex: '2 1 300px' }}>
                  <Field>
                    <FieldLabel htmlFor="profile-headline">Headline</FieldLabel>
                    <Input id="profile-headline" value={profile.headline} onChange={event => set({ headline: event.target.value })} />
                  </Field>
                </div>
                <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
                  <Field>
                    <FieldLabel htmlFor="profile-location">Lives in</FieldLabel>
                    <Input id="profile-location" placeholder="City, country" value={profile.location} onChange={event => set({ location: event.target.value })} />
                  </Field>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Experience</CardTitle>
            </CardHeader>
            <CardContent>
              <RolesList roles={profile.roles} skills={profile.skills} onChange={roles => set({ roles })} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectsList projects={profile.projects} onChange={projects => set({ projects })} />
            </CardContent>
          </Card>
        </div>
        <div className="nx:flex nx:flex-col nx:gap-5 nx:min-w-0" style={{ flex: '1 1 300px' }}>
          <Card>
            <CardHeader>
              <CardTitle>Skills</CardTitle>
            </CardHeader>
            <CardContent>
              <ChipsInput values={profile.skills} onChange={skills => set({ skills })} placeholder="Add a skill" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Links</CardTitle>
            </CardHeader>
            <CardContent>
              <LinksEditor links={profile.links} onChange={links => set({ links })} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Never mention or link</CardTitle>
            </CardHeader>
            <CardContent>
              <Field>
                <Textarea aria-label="Never mention or link" rows={3} placeholder="One per line" value={profile.never} onChange={event => set({ never: event.target.value })} />
                <FieldDescription>Claude never writes these into a form or a message.</FieldDescription>
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>From a resume</CardTitle>
              <CardDescription>Claude reads it again and shows what it found, for you to accept.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" size="sm" startIcon={<UploadSimpleIcon />} loading={isReading} onClick={() => void readResume()}>
                {isReading ? 'Claude is reading it' : 'Update from your resume'}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
      <SaveBar isDirty={!same(profile, settings.profile)} label="Save profile" onSave={() => void attempt(() => api.settings.setProfile(profile), 'Profile saved')} />
      {found && (
        <Dialog open onOpenChange={open => !open && setFound(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Claude read your resume</DialogTitle>
              <DialogDescription>
                It found {found.roles.length} roles, {found.projects.length} projects and {found.skills.length} skills. Use them in place of what is here? Your name and headline stay unless you have none.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ul className="nx:typography-body-small nx:m-0 nx:pl-5 nx:flex nx:flex-col nx:gap-1">
                {found.roles.map(role => (
                  <li key={role.id}>
                    {role.title}, {role.company}
                  </li>
                ))}
              </ul>
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
                Use these, then save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function AnswerRow({ answer }: { answer: FormAnswer }): JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [text, setText] = useState(answer.answer)
  return (
    <TableRow>
      <TableCell>{answer.question}</TableCell>
      <TableCell>
        {isEditing ? <Input aria-label={`Answer to ${answer.question}`} value={text} onChange={event => setText(event.target.value)} autoFocus /> : answer.answer}
      </TableCell>
      <TableCell className="nx:tabular-nums">{day(answer.updated)}</TableCell>
      <TableCell className="nx:text-end nx:whitespace-nowrap">
        {isEditing ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => void attempt(() => api.settings.saveAnswer(answer.question, text), 'Answer saved').then(() => setIsEditing(false))}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" startIcon={<PencilSimpleIcon />} onClick={() => setIsEditing(true)}>
              Edit
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${answer.question}`} onClick={() => void attempt(() => api.settings.removeAnswer(answer.id))}>
              <TrashIcon />
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  )
}

function AnswersTab(): JSX.Element {
  const answers = useData(() => api.settings.answers(), [], ['answers'])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [search, setSearch] = useState('')
  const shown = (answers.data ?? []).filter(one => `${one.question} ${one.answer}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="nx:flex nx:flex-col nx:gap-4 nx:pt-4">
      <p className="nx:typography-body-default nx:m-0 nx:text-muted-foreground">
        Facts forms ask for, learned once and reused everywhere. A form that asks something new stops and asks you, then saves the answer here. Factual fields are always answered truthfully from these.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Add an answer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="nx:flex nx:flex-wrap nx:gap-3 nx:items-end">
            <div className="nx:min-w-0" style={{ flex: '2 1 280px' }}>
              <Field>
                <FieldLabel htmlFor="answer-question">Question</FieldLabel>
                <Input id="answer-question" placeholder="For example: Notice period" value={question} onChange={event => setQuestion(event.target.value)} />
              </Field>
            </div>
            <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
              <Field>
                <FieldLabel htmlFor="answer-text">Answer</FieldLabel>
                <Input id="answer-text" value={answer} onChange={event => setAnswer(event.target.value)} />
              </Field>
            </div>
            <Button
              variant="secondary"
              startIcon={<PlusIcon />}
              disabled={!question.trim() || !answer.trim()}
              onClick={() =>
                void attempt(() => api.settings.saveAnswer(question, answer), 'Answer saved').then(() => {
                  setQuestion('')
                  setAnswer('')
                })
              }
            >
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="nx:flex nx:flex-wrap nx:gap-2 nx:items-center">
        <div className="nx:min-w-0" style={{ flex: '1 1 240px' }}>
          <Input type="search" aria-label="Search answers" placeholder="Search questions" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <span className="nx:typography-body-small nx:text-muted-foreground">{answers.data?.length ?? 0} answers</span>
      </div>
      {!answers.data ? (
        <Loading />
      ) : (
        <Table aria-label="Form answers" density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>Question</TableHead>
              <TableHead>Answer</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>
                <Hidden>Actions</Hidden>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(one => (
              <AnswerRow key={`${one.id}-${one.updated}-${one.answer}`} answer={one} />
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="nx:text-muted-foreground">
                  No answers yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function ResumeTab({ settings }: { settings: SettingsValue }): JSX.Element {
  const resume = settings.resume
  return (
    <div className="nx:flex nx:flex-wrap nx:gap-6 nx:items-start nx:pt-4">
      <div className="nx:flex nx:flex-col nx:gap-4 nx:min-w-0" style={{ flex: '999 1 560px' }}>
        {resume ? (
          <Item variant="outline">
            <ItemMedia variant="icon">
              <FilePdfIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{resume.fileName}</ItemTitle>
              <ItemDescription>
                {resume.pages ? `${resume.pages} ${resume.pages === 1 ? 'page' : 'pages'}, ` : ''}
                {Math.round(resume.bytes / 1024)} KB, added {day(resume.addedAt)}. Kept in the app's data folder.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="ghost" size="sm" startIcon={<EyeIcon />} onClick={() => void attempt(() => api.settings.openResume())}>
                Open
              </Button>
              <Button variant="ghost" size="sm" startIcon={<TrashIcon />} onClick={() => void attempt(() => api.settings.removeResume(), 'Resume removed')}>
                Remove
              </Button>
            </ItemActions>
          </Item>
        ) : (
          <span className="nx:typography-body-default nx:text-muted-foreground">No resume yet.</span>
        )}
        <div className="nx:flex nx:flex-col nx:items-center nx:gap-3 nx:p-8 nx:rounded-md nx:text-center" style={{ border: '1px dashed var(--nx-color-border-default)' }}>
          <UploadSimpleIcon size={24} />
          <span className="nx:typography-label-default">{resume ? 'Replace with a new PDF' : 'Add your resume'}</span>
          <span className="nx:typography-body-small nx:text-muted-foreground">It is copied into the app's data folder and used for every run after this.</span>
          <Button variant="outline" size="sm" onClick={() => void attempt(() => api.settings.chooseResume(), 'Resume saved')}>
            Choose a PDF
          </Button>
        </div>
      </div>
      <div className="nx:flex nx:flex-col nx:gap-6 nx:min-w-0" style={{ flex: '1 1 300px' }}>
        {resume && (
          <Card>
            <CardHeader>
              <CardTitle>Checked when added</CardTitle>
            </CardHeader>
            <CardContent>
              <CheckList
                items={[
                  { state: 'ok', text: `A PDF${resume.pages ? `, ${resume.pages} ${resume.pages === 1 ? 'page' : 'pages'}` : ''}` },
                  { state: resume.bytes <= 2 * 1024 * 1024 ? 'ok' : 'warn', text: resume.bytes <= 2 * 1024 * 1024 ? 'Under the 2 MB most forms allow' : 'Over 2 MB: some forms refuse it' },
                ]}
              />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Where it goes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="nx:typography-body-small nx:m-0 nx:pl-5 nx:flex nx:flex-col nx:gap-2">
              <li>Uploaded with every application</li>
              <li>Attached to every referral message, unless you turn that off</li>
              <li>A form that wants a cover letter as a file is handed to you</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const SLOTS = ['{name}', '{role}', '{company}', '{job link}'] as const

function MessageTab({ settings }: { settings: SettingsValue }): JSX.Element {
  const [message, setMessage] = useState<ReferralMessage>(settings.referral)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setMessage(settings.referral), [settings.referral])

  const insert = (slot: string): void => {
    const el = box.current
    const at = el ? el.selectionStart : message.template.length
    const end = el ? el.selectionEnd : at
    const template = message.template.slice(0, at) + slot + message.template.slice(end)
    setMessage(current => ({ ...current, template }))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + slot.length, at + slot.length)
    })
  }
  const preview = message.template.replace(/\{name\}|\{role\}|\{company\}|\{job link\}/g, slot => `[${slot.slice(1, -1)}]`)

  return (
    <div className="nx:flex nx:flex-wrap nx:gap-6 nx:items-start nx:pt-4">
      <div className="nx:flex nx:flex-col nx:gap-4 nx:min-w-0" style={{ flex: '999 1 520px' }}>
        <Card>
          <CardHeader>
            <CardTitle>Your approved wording</CardTitle>
            <CardDescription>Sent word for word. Saving a change here approves the new wording for every later message.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="message-body">Message</FieldLabel>
                <Textarea id="message-body" ref={box} rows={10} value={message.template} onChange={event => setMessage(current => ({ ...current, template: event.target.value }))} />
                <FieldDescription>Only these four slots may appear. Anything else in braces is refused on save.</FieldDescription>
              </Field>
              <div className="nx:flex nx:flex-wrap nx:gap-2 nx:items-center">
                <span className="nx:typography-body-small nx:text-muted-foreground">Insert</span>
                {SLOTS.map(slot => (
                  <Button key={slot} variant="outline" size="sm" onClick={() => insert(slot)}>
                    {slot}
                  </Button>
                ))}
              </div>
              <Field orientation="horizontal">
                <Switch id="message-resume" checked={message.attachResume} onCheckedChange={attachResume => setMessage(current => ({ ...current, attachResume }))} />
                <FieldLabel htmlFor="message-resume">Attach your resume</FieldLabel>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button disabled={same(message, settings.referral)} onClick={() => void attempt(() => api.settings.setReferral(message), 'Message saved')}>
              Save message
            </Button>
          </CardFooter>
        </Card>
      </div>
      <div className="nx:flex nx:flex-col nx:gap-6 nx:min-w-0" style={{ flex: '1 1 320px' }}>
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>The slots in brackets are filled for each person.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="nx:typography-body-small nx:p-3 nx:rounded-md nx:bg-muted nx:text-foreground nx:whitespace-pre-wrap">{preview || 'Nothing yet.'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Where the details come from</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionListItem>
                <DescriptionListTerm>{'{name}'}</DescriptionListTerm>
                <DescriptionListDescription>The person's first name, from their profile</DescriptionListDescription>
              </DescriptionListItem>
              <DescriptionListItem>
                <DescriptionListTerm>{'{role}, {company}'}</DescriptionListTerm>
                <DescriptionListDescription>The applied row at their company</DescriptionListDescription>
              </DescriptionListItem>
              <DescriptionListItem>
                <DescriptionListTerm>{'{job link}'}</DescriptionListTerm>
                <DescriptionListDescription>That row's posting link</DescriptionListDescription>
              </DescriptionListItem>
            </DescriptionList>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function PortalsTab({ settings }: { settings: SettingsValue }): JSX.Element {
  const [selected, setSelected] = useState<Portal>('linkedin')
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const portals = settings.portals
  const save = (next: PortalSettings): void => void attempt(() => api.settings.setPortals(next))
  const setting = portals[selected]
  const tools = PORTAL_TOOLS[selected]
  const groups = [...new Set(tools.map(tool => tool.group))]
  const site = sites.data?.find(one => one.site === selected)

  return (
    <div className="nx:flex nx:flex-wrap nx:gap-6 nx:items-start nx:pt-4">
      <nav aria-label="Portals" className="nx:flex nx:flex-col nx:gap-1 nx:min-w-0" style={{ flex: '1 1 220px' }}>
        {PORTALS.map(portal => {
          const on = Object.values(portals[portal].tools).filter(Boolean).length
          return (
            <button
              key={portal}
              type="button"
              className={`nx:flex nx:flex-col nx:gap-1 nx:p-3 nx:rounded-md nx:text-left nx:border-0 nx:cursor-pointer ${selected === portal ? 'nx:bg-muted' : 'nx:bg-transparent'}`}
              onClick={() => setSelected(portal)}
            >
              <span className="nx:typography-label-default nx:text-foreground">{PORTAL_NAMES[portal]}</span>
              <span className="nx:typography-body-small nx:text-muted-foreground">
                {portals[portal].enabled ? `On, ${on} of ${PORTAL_TOOLS[portal].length} tools` : 'Off'}
              </span>
            </button>
          )
        })}
      </nav>
      <div className="nx:flex nx:flex-col nx:gap-5 nx:min-w-0" style={{ flex: '999 1 560px' }}>
        <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-3">
          <div className="nx:flex nx:flex-col nx:gap-1">
            <h2 className="nx:typography-heading-medium nx:m-0">{PORTAL_NAMES[selected]}</h2>
            <span className="nx:typography-body-small nx:text-muted-foreground">
              {site?.state === 'signed-in' ? `Signed in. Checked ${when(site.checked)}.` : site?.state === 'signed-out' ? 'Signed out. Sign in from Accounts.' : 'Sign-in not checked yet.'}
            </span>
          </div>
          <Field orientation="horizontal">
            <Switch id={`use-${selected}`} checked={setting.enabled} onCheckedChange={enabled => save({ ...portals, [selected]: { ...setting, enabled } })} />
            <FieldLabel htmlFor={`use-${selected}`}>Use {PORTAL_NAMES[selected]}</FieldLabel>
          </Field>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>What Claude may do here</CardTitle>
            <CardDescription>Turn a tool off and the step that needs it is handed to you in Chrome.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="nx:flex nx:flex-col nx:gap-5">
              {groups.map((group, i) => (
                <div key={group} className="nx:flex nx:flex-col nx:gap-3">
                  {i > 0 && <Separator />}
                  <span className="nx:typography-label-caps nx:text-muted-foreground">{PORTAL_TOOL_GROUP_NAMES[group]}</span>
                  {tools
                    .filter(tool => tool.group === group)
                    .map(tool => (
                      <div key={tool.name} className="nx:flex nx:items-center nx:justify-between nx:gap-3">
                        <div className="nx:flex nx:flex-col nx:gap-1">
                          <span className="nx:typography-label-default">{tool.label}</span>
                          <span className="nx:typography-body-small nx:text-muted-foreground">
                            <code className="nx:typography-code-inline">{tool.name}</code> {tool.detail}
                          </span>
                          {tool.asksFirst && (
                            <div>
                              <Badge variant="warning" fill="light" isCaps={false} leftIcon={tool.name.includes('referral') ? <ShieldCheckIcon /> : <HandPalmIcon />}>
                                {tool.asksFirst}
                              </Badge>
                            </div>
                          )}
                        </div>
                        <Switch
                          aria-label={tool.label}
                          checked={setting.tools[tool.name] !== false}
                          disabled={!setting.enabled}
                          onCheckedChange={on => save({ ...portals, [selected]: { ...setting, tools: { ...setting.tools, [tool.name]: on } } })}
                        />
                      </div>
                    ))}
                </div>
              ))}
              <Separator />
              <span className="nx:typography-label-caps nx:text-muted-foreground">Anything else</span>
              <div className="nx:flex nx:items-center nx:justify-between nx:gap-3">
                <div className="nx:flex nx:flex-col nx:gap-1">
                  <span className="nx:typography-label-default">Free browsing on {PORTAL_NAMES[selected]}</span>
                  <span className="nx:typography-body-small nx:text-muted-foreground">
                    Open, read, click and type on pages the tools above don't cover. Off: Claude uses only the tools above.
                  </span>
                </div>
                <Switch
                  aria-label={`Free browsing on ${PORTAL_NAMES[selected]}`}
                  checked={setting.freeBrowsing}
                  disabled={!setting.enabled}
                  onCheckedChange={freeBrowsing => save({ ...portals, [selected]: { ...setting, freeBrowsing } })}
                />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Playbook</CardTitle>
            <CardDescription>The short notes Claude gets for {PORTAL_NAMES[selected]}, beyond what the tools do. Part of the app, updated with each release.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="nx:typography-body-small nx:m-0 nx:py-3 nx:pr-3 nx:pl-8 nx:rounded-md nx:bg-muted nx:flex nx:flex-col nx:gap-2">
              {PLAYBOOKS[selected].map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function AccountsTab(): JSX.Element {
  const status = useAppStatus()
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const info = useData(() => api.chrome.info(), [], [])
  const claude = status?.claude
  const browser = status?.browser

  return (
    <div className="nx:flex nx:flex-col nx:gap-6 nx:pt-4">
      <div className="nx:flex nx:flex-wrap nx:gap-6 nx:items-stretch">
        <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 360px' }}>
          <Card className="nx:w-full">
            <CardHeader>
              <CardTitle>Claude</CardTitle>
              <CardDescription>Your own installed Claude Code, signed in with your own Claude account. Runs use your plan. The app never sees your password or token.</CardDescription>
              <CardAction>
                <Badge variant={claude?.state === 'ok' ? 'success' : 'warning'} fill="light" isCaps={false} leftIcon={claude?.state === 'ok' ? <CheckCircleIcon /> : <WarningIcon />}>
                  {claude?.state === 'ok' ? 'Signed in' : claude?.state === 'checking' ? 'Checking' : 'Needs attention'}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <DescriptionList>
                <DescriptionListItem>
                  <DescriptionListTerm>Status</DescriptionListTerm>
                  <DescriptionListDescription>{claude?.message}</DescriptionListDescription>
                </DescriptionListItem>
                {claude?.account?.subscriptionType && (
                  <DescriptionListItem>
                    <DescriptionListTerm>Plan</DescriptionListTerm>
                    <DescriptionListDescription>{claude.account.subscriptionType}</DescriptionListDescription>
                  </DescriptionListItem>
                )}
                {claude?.path && (
                  <DescriptionListItem>
                    <DescriptionListTerm>Claude Code</DescriptionListTerm>
                    <DescriptionListDescription>
                      {claude.version ? `${claude.version}, ` : ''}
                      {claude.path}
                    </DescriptionListDescription>
                  </DescriptionListItem>
                )}
              </DescriptionList>
            </CardContent>
            <CardFooter>
              <div className="nx:flex nx:flex-col nx:gap-2">
                <div>
                  <Button variant="outline" size="sm" startIcon={<ArrowsClockwiseIcon />} onClick={() => void attempt(() => api.checkClaude())}>
                    Check again
                  </Button>
                </div>
                <span className="nx:typography-body-small nx:text-muted-foreground">Signed out? Run claude auth login in a terminal, then check again.</span>
              </div>
            </CardFooter>
          </Card>
        </div>
        <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 360px' }}>
          <Card className="nx:w-full">
            <CardHeader>
              <CardTitle>Chrome</CardTitle>
              <CardDescription>Your installed Google Chrome, with the app's own profile, opened beside the app.</CardDescription>
              <CardAction>
                <Badge variant={browser?.mode === 'controlled' ? 'information' : 'secondary'} fill="light" isCaps={false} leftIcon={<BrowserIcon />}>
                  {browser?.mode === 'controlled' ? 'Controlled' : browser?.mode === 'signin' ? 'Open to sign in' : 'Closed'}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <DescriptionList>
                <DescriptionListItem>
                  <DescriptionListTerm>Chrome</DescriptionListTerm>
                  <DescriptionListDescription>{info.data ? info.data.chromePath ?? 'Not found: install Google Chrome in Applications' : ''}</DescriptionListDescription>
                </DescriptionListItem>
                <DescriptionListItem>
                  <DescriptionListTerm>Controlled</DescriptionListTerm>
                  <DescriptionListDescription>The app drives it through a private pipe. Flows run in this mode.</DescriptionListDescription>
                </DescriptionListItem>
                <DescriptionListItem>
                  <DescriptionListTerm>For signing in</DescriptionListTerm>
                  <DescriptionListDescription>No control link at all, so Google accepts the sign-in.</DescriptionListDescription>
                </DescriptionListItem>
                <DescriptionListItem>
                  <DescriptionListTerm>Profile</DescriptionListTerm>
                  <DescriptionListDescription>{info.data?.profileDir}</DescriptionListDescription>
                </DescriptionListItem>
              </DescriptionList>
              {browser?.error && <p className="nx:typography-body-small nx:text-error-subtle-foreground nx:mt-3 nx:mb-0">{browser.error}</p>}
            </CardContent>
            <CardFooter>
              <div className="nx:flex nx:flex-wrap nx:gap-2">
                {browser?.mode === 'closed' ? (
                  <>
                    <Button variant="outline" size="sm" startIcon={<SignInIcon />} onClick={() => void attempt(() => api.chrome.open('signin'))}>
                      Open to sign in
                    </Button>
                    <Button variant="ghost" size="sm" startIcon={<BrowserIcon />} onClick={() => void attempt(() => api.chrome.open('controlled'))}>
                      Open controlled
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" startIcon={<XIcon />} onClick={() => void attempt(() => api.chrome.close())}>
                    Close Chrome
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
      <section className="nx:flex nx:flex-col nx:gap-3">
        <h2 className="nx:typography-heading-small nx:m-0">Sites</h2>
        <Table aria-label="Site sign-ins" density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>Site</TableHead>
              <TableHead>Sign-in</TableHead>
              <TableHead>Last checked</TableHead>
              <TableHead>
                <Hidden>Actions</Hidden>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(sites.data ?? []).map(site => (
              <TableRow key={site.site}>
                <TableCell>
                  <span className="nx:typography-label-default">{SITE_NAMES[site.site as SignInSite] ?? site.site}</span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={site.state === 'signed-in' ? 'success' : site.state === 'signed-out' ? 'warning' : 'secondary'}
                    fill="light"
                    isCaps={false}
                    leftIcon={site.state === 'signed-in' ? <CheckCircleIcon /> : site.state === 'signed-out' ? <WarningIcon /> : undefined}
                  >
                    {site.state === 'signed-in' ? 'Signed in' : site.state === 'signed-out' ? 'Signed out' : 'Not checked yet'}
                  </Badge>
                </TableCell>
                <TableCell className="nx:tabular-nums">{when(site.checked)}</TableCell>
                <TableCell className="nx:text-end">
                  <Button
                    variant="outline"
                    size="sm"
                    startIcon={<SignInIcon />}
                    onClick={() => void attempt(() => api.chrome.signIn(site.site as SignInSite))}
                  >
                    Sign in
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <span className="nx:typography-body-small nx:text-muted-foreground">
          Signing in is always yours: the app opens the page in Chrome, and you type. Claude never types a password or a code. Sign in to Google only in "Open to sign in" mode.
        </span>
      </section>
      <div>
        <Button variant="ghost" size="sm" startIcon={<RobotIcon />} onClick={() => go('/settings/portals')}>
          What Claude may do on each portal
        </Button>
      </div>
    </div>
  )
}

/** Settings: entered once, used by every flow. */
export function Settings({ tab }: { tab: string }): JSX.Element {
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const current = TABS.some(([value]) => value === tab) ? tab : 'preferences'

  return (
    <Page title="Settings" description="Entered once, used by every flow. Claude writes only from what is here.">
      {settings.error && <ErrorNote text={settings.error} />}
      {!settings.data ? (
        <Loading />
      ) : (
        <Tabs value={current} onValueChange={value => go(`/settings/${value}`)}>
          <TabsList variant="underline">
            {TABS.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="preferences">
            <PreferencesTab settings={settings.data} />
          </TabsContent>
          <TabsContent value="profile">
            <ProfileTab settings={settings.data} />
          </TabsContent>
          <TabsContent value="answers">
            <AnswersTab />
          </TabsContent>
          <TabsContent value="resume">
            <ResumeTab settings={settings.data} />
          </TabsContent>
          <TabsContent value="message">
            <MessageTab settings={settings.data} />
          </TabsContent>
          <TabsContent value="portals">
            <PortalsTab settings={settings.data} />
          </TabsContent>
          <TabsContent value="accounts">
            <AccountsTab />
          </TabsContent>
        </Tabs>
      )}
    </Page>
  )
}
