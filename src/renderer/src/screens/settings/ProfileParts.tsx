import { useState } from 'react'
import type { JSX } from 'react'

import { GithubLogoIcon, GlobeIcon, LinkedinLogoIcon, LinkIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'

import type { Profile, ProfileLinks, Project, Role } from '../../../../shared/types'
import { Group } from '../../ui/common'
import { ListBox, ListRow, MonthPicker, Tags } from '../../ui/fields'
import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
} from '../../ui/nx'

const newId = (): string => crypto.randomUUID()

const EMPTY_ROLE = (): Role => ({ id: newId(), title: '', company: '', start: '', end: null, isCurrent: false, built: '', skills: [] })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** YYYY-MM as "Mar 2024". */
const monthLabel = (value: string | null): string => {
  if (!value) return ''
  const [year, month] = value.split('-')
  return `${MONTHS[Number(month) - 1] ?? ''} ${year}`.trim()
}

const roleDates = (role: Role): string => `${monthLabel(role.start) || 'Start unknown'} to ${role.isCurrent ? 'now' : monthLabel(role.end) || 'unknown'}`

/** The panel a role is edited in, from the right. */
function RoleSheet(props: { role: Role | null; skills: string[]; onClose: () => void; onSave: (role: Role) => void; onDelete: (id: string) => void }): JSX.Element {
  const [role, setRole] = useState<Role>(props.role ?? EMPTY_ROLE())
  const set = (patch: Partial<Role>): void => setRole(current => ({ ...current, ...patch }))
  const isNew = !props.role

  return (
    <Sheet open onOpenChange={open => !open && props.onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isNew ? 'Add role' : 'Edit role'}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="role-title">Title</FieldLabel>
              <Input id="role-title" value={role.title} onChange={event => set({ title: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="role-company">Company</FieldLabel>
              <Input id="role-company" value={role.company} onChange={event => set({ company: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="role-start">Started</FieldLabel>
              <MonthPicker id="role-start" ariaLabel="Started" value={role.start} onChange={start => set({ start })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="role-end">Ended</FieldLabel>
              <MonthPicker id="role-end" ariaLabel="Ended" disabled={role.isCurrent} value={role.end ?? ''} onChange={end => set({ end: end || null })} />
            </Field>
            <Field orientation="horizontal">
              <Switch id="role-current" checked={role.isCurrent} onCheckedChange={isCurrent => set({ isCurrent, end: isCurrent ? null : role.end })} />
              <FieldLabel htmlFor="role-current">I work here now</FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="role-built">What you built</FieldLabel>
              <Textarea id="role-built" rows={6} value={role.built} onChange={event => set({ built: event.target.value })} />
              <FieldDescription>One point per line. Claude uses it as written and never adds to it.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="role-skills">Skills here</FieldLabel>
              <Tags id="role-skills" ariaLabel="Skills here" values={role.skills} suggestions={props.skills} onChange={skills => set({ skills })} placeholder="Add a skill" />
            </Field>
          </FieldGroup>
        </SheetBody>
        <SheetFooter>
          <div className="nx:flex nx:items-center nx:justify-between nx:gap-2 nx:w-full">
            {isNew ? (
              <span />
            ) : (
              <Button variant="ghost" startIcon={<TrashIcon />} onClick={() => props.onDelete(role.id)}>
                Delete role
              </Button>
            )}
            <div className="nx:flex nx:gap-2">
              <Button variant="outline" onClick={props.onClose}>
                Cancel
              </Button>
              <Button disabled={!role.title.trim() || !role.company.trim()} onClick={() => props.onSave(role)}>
                Save role
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** The roles in a profile, newest first, each edited in a sheet. */
export function RolesList({ roles, skills, onChange }: { roles: Role[]; skills: string[]; onChange: (roles: Role[]) => void }): JSX.Element {
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const sorted = [...roles].sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || (b.start || '').localeCompare(a.start || ''))
  return (
    <Group
      title="Experience"
      action={
        <Button variant="ghost" size="sm" startIcon={<PlusIcon />} onClick={() => setEditing('new')}>
          Add role
        </Button>
      }
    >
      {sorted.length === 0 ? (
        <span className="nx:typography-body-small nx:text-muted-foreground">No roles yet.</span>
      ) : (
        <ListBox label="Experience">
          {sorted.map(role => (
            <ListRow
              key={role.id}
              title={role.title || 'Untitled role'}
              detail={`${role.company} · ${roleDates(role)}`}
              onClick={() => setEditing(role)}
              actions={
                <Button variant="ghost" size="sm" onClick={() => setEditing(role)}>
                  Edit
                </Button>
              }
            />
          ))}
        </ListBox>
      )}
      {editing && (
        <RoleSheet
          role={editing === 'new' ? null : editing}
          skills={skills}
          onClose={() => setEditing(null)}
          onSave={role => {
            onChange(roles.some(one => one.id === role.id) ? roles.map(one => (one.id === role.id ? role : one)) : [...roles, role])
            setEditing(null)
          }}
          onDelete={id => {
            onChange(roles.filter(one => one.id !== id))
            setEditing(null)
          }}
        />
      )}
    </Group>
  )
}

function ProjectSheet(props: { project: Project | null; onClose: () => void; onSave: (project: Project) => void; onDelete: (id: string) => void }): JSX.Element {
  const [project, setProject] = useState<Project>(props.project ?? { id: newId(), name: '', link: '', about: '' })
  const set = (patch: Partial<Project>): void => setProject(current => ({ ...current, ...patch }))
  return (
    <Sheet open onOpenChange={open => !open && props.onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{props.project ? 'Edit project' : 'Add project'}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input id="project-name" value={project.name} onChange={event => set({ name: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-link">Public link</FieldLabel>
              <Input id="project-link" type="url" placeholder="https://" value={project.link} onChange={event => set({ link: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-about">What it is, and what you built</FieldLabel>
              <Textarea id="project-about" rows={6} value={project.about} onChange={event => set({ about: event.target.value })} />
            </Field>
          </FieldGroup>
        </SheetBody>
        <SheetFooter>
          <div className="nx:flex nx:items-center nx:justify-between nx:gap-2 nx:w-full">
            {props.project ? (
              <Button variant="ghost" startIcon={<TrashIcon />} onClick={() => props.onDelete(project.id)}>
                Delete project
              </Button>
            ) : (
              <span />
            )}
            <div className="nx:flex nx:gap-2">
              <Button variant="outline" onClick={props.onClose}>
                Cancel
              </Button>
              <Button disabled={!project.name.trim()} onClick={() => props.onSave(project)}>
                Save project
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function ProjectsList({ projects, onChange }: { projects: Project[]; onChange: (projects: Project[]) => void }): JSX.Element {
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  return (
    <Group
      title="Projects"
      action={
        <Button variant="ghost" size="sm" startIcon={<PlusIcon />} onClick={() => setEditing('new')}>
          Add project
        </Button>
      }
    >
      {projects.length === 0 ? (
        <span className="nx:typography-body-small nx:text-muted-foreground">No projects yet.</span>
      ) : (
        <ListBox label="Projects">
          {projects.map(project => (
            <ListRow
              key={project.id}
              title={project.name}
              detail={project.link || project.about.split('\n')[0]}
              onClick={() => setEditing(project)}
              actions={
                <Button variant="ghost" size="sm" onClick={() => setEditing(project)}>
                  Edit
                </Button>
              }
            />
          ))}
        </ListBox>
      )}
      {editing && (
        <ProjectSheet
          project={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={project => {
            onChange(projects.some(one => one.id === project.id) ? projects.map(one => (one.id === project.id ? project : one)) : [...projects, project])
            setEditing(null)
          }}
          onDelete={id => {
            onChange(projects.filter(one => one.id !== id))
            setEditing(null)
          }}
        />
      )}
    </Group>
  )
}

function LinkInput(props: { id: string; icon: JSX.Element; value: string; placeholder: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <InputGroup>
      <InputGroupAddon align="inline-start">{props.icon}</InputGroupAddon>
      <InputGroupInput id={props.id} type="url" placeholder={props.placeholder} value={props.value} onChange={event => props.onChange(event.target.value)} />
    </InputGroup>
  )
}

/** The profile links as settings rows: one per platform, then any others by name. */
export function linkRows(links: ProfileLinks, onChange: (links: ProfileLinks) => void): { label: string; id?: string; tip?: string; control: JSX.Element }[] {
  const set = (patch: Partial<ProfileLinks>): void => onChange({ ...links, ...patch })
  const setOther = (i: number, patch: Partial<ProfileLinks['other'][number]>): void => set({ other: links.other.map((one, j) => (j === i ? { ...one, ...patch } : one)) })
  return [
    {
      label: 'LinkedIn',
      id: 'link-linkedin',
      control: <LinkInput id="link-linkedin" icon={<LinkedinLogoIcon />} placeholder="linkedin.com/in/" value={links.linkedin} onChange={linkedin => set({ linkedin })} />,
    },
    { label: 'GitHub', id: 'link-github', control: <LinkInput id="link-github" icon={<GithubLogoIcon />} placeholder="github.com/" value={links.github} onChange={github => set({ github })} /> },
    { label: 'Website', id: 'link-site', control: <LinkInput id="link-site" icon={<GlobeIcon />} placeholder="https://" value={links.site} onChange={site => set({ site })} /> },
    {
      label: 'Other links',
      tip: 'A form that asks for a link gets the one it names',
      control: (
        <div className="nx:flex nx:flex-col nx:gap-2">
          {links.other.map((link, i) => (
            <div key={i} className="nx:grid nx:gap-2 nx:items-center" style={{ gridTemplateColumns: '120px minmax(0, 1fr) auto' }}>
              <Input aria-label="Link name" placeholder="Name" value={link.name} onChange={event => setOther(i, { name: event.target.value })} />
              <LinkInput id={`link-other-${i}`} icon={<LinkIcon />} placeholder="https://" value={link.url} onChange={url => setOther(i, { url })} />
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${link.name || 'this link'}`} onClick={() => set({ other: links.other.filter((_, j) => j !== i) })}>
                <TrashIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button variant="ghost" size="sm" startIcon={<PlusIcon />} disabled={links.other.length >= 10} onClick={() => set({ other: [...links.other, { name: '', url: '' }] })}>
              Add link
            </Button>
          </div>
        </div>
      ),
    },
  ]
}

/** The editable parts of a profile, shared by onboarding and Settings. */
export type ProfileSetter = (patch: Partial<Profile>) => void
