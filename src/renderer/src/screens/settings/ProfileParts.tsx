import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'

import type { Profile, ProfileLinks, Project, Role } from '../../../../shared/types'
import { ChipsInput } from '../../ui/common'
import {
  Button,
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
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  Switch,
  Textarea,
} from '../../ui/nx'

const newId = (): string => crypto.randomUUID()

const EMPTY_ROLE = (): Role => ({ id: newId(), title: '', company: '', start: '', end: null, isCurrent: false, built: '', skills: [] })

function RoleDialog(props: { role: Role | null; skills: string[]; onClose: () => void; onSave: (role: Role) => void; onDelete: (id: string) => void }): JSX.Element {
  const [role, setRole] = useState<Role>(props.role ?? EMPTY_ROLE())
  useEffect(() => setRole(props.role ?? EMPTY_ROLE()), [props.role])
  const set = (patch: Partial<Role>): void => setRole(current => ({ ...current, ...patch }))
  const isNew = !props.role

  return (
    <Dialog open onOpenChange={open => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add a role' : 'Edit role'}</DialogTitle>
          <DialogDescription>Claude uses this role exactly as written here, in written answers and in scoring postings. It never adds to it.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <div className="nx:flex nx:flex-wrap nx:gap-3">
              <div className="nx:min-w-0" style={{ flex: '1 1 180px' }}>
                <Field>
                  <FieldLabel htmlFor="role-title">Job title</FieldLabel>
                  <Input id="role-title" value={role.title} onChange={event => set({ title: event.target.value })} />
                </Field>
              </div>
              <div className="nx:min-w-0" style={{ flex: '1 1 180px' }}>
                <Field>
                  <FieldLabel htmlFor="role-company">Company</FieldLabel>
                  <Input id="role-company" value={role.company} onChange={event => set({ company: event.target.value })} />
                </Field>
              </div>
            </div>
            <div className="nx:flex nx:flex-wrap nx:gap-3 nx:items-end">
              <div className="nx:min-w-0" style={{ flex: '1 1 140px' }}>
                <Field>
                  <FieldLabel htmlFor="role-start">Started</FieldLabel>
                  <Input id="role-start" type="month" value={role.start} onChange={event => set({ start: event.target.value })} />
                </Field>
              </div>
              <div className="nx:min-w-0" style={{ flex: '1 1 140px' }}>
                <Field>
                  <FieldLabel htmlFor="role-end">Ended</FieldLabel>
                  <Input id="role-end" type="month" disabled={role.isCurrent} value={role.end ?? ''} onChange={event => set({ end: event.target.value || null })} />
                </Field>
              </div>
              <Field orientation="horizontal">
                <Switch id="role-current" checked={role.isCurrent} onCheckedChange={isCurrent => set({ isCurrent, end: isCurrent ? null : role.end })} />
                <FieldLabel htmlFor="role-current">I work here now</FieldLabel>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="role-built">What you built there</FieldLabel>
              <Textarea id="role-built" rows={6} value={role.built} onChange={event => set({ built: event.target.value })} />
              <FieldDescription>One point per line: what you built, the problem it solved, and the technology you used.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="role-skills">Skills used in this role</FieldLabel>
              <ChipsInput id="role-skills" values={role.skills} onChange={skills => set({ skills })} placeholder={props.skills.length ? `Such as ${props.skills.slice(0, 2).join(', ')}` : 'Add a skill'} />
              <FieldDescription>Years with each skill on forms are worked out from the roles that list it.</FieldDescription>
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          {!isNew && (
            <div className="nx:flex-1">
              <Button variant="ghost" startIcon={<TrashIcon />} onClick={() => props.onDelete(role.id)}>
                Delete role
              </Button>
            </div>
          )}
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!role.title.trim() || !role.company.trim()} onClick={() => props.onSave(role)}>
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const roleDates = (role: Role): string => {
  const start = role.start || 'Unknown start'
  return `${start} to ${role.isCurrent ? 'present' : role.end || 'unknown'}`
}

/** The roles in a profile, each edited in its own dialog. */
export function RolesList({ roles, skills, onChange }: { roles: Role[]; skills: string[]; onChange: (roles: Role[]) => void }): JSX.Element {
  const [editing, setEditing] = useState<Role | null | 'new'>(null)
  const sorted = [...roles].sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || (b.start || '').localeCompare(a.start || ''))
  return (
    <div className="nx:flex nx:flex-col nx:gap-2">
      {sorted.length === 0 ? (
        <span className="nx:typography-body-small nx:text-muted-foreground">No roles yet.</span>
      ) : (
        <ItemGroup>
          {sorted.map((role, i) => (
            <div key={role.id}>
              {i > 0 && <ItemSeparator />}
              <Item size="sm">
                <ItemContent>
                  <ItemTitle>
                    {role.title}, {role.company}
                  </ItemTitle>
                  <ItemDescription>
                    {roleDates(role)}. {role.built.split('\n')[0]}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="sm" startIcon={<PencilSimpleIcon />} onClick={() => setEditing(role)}>
                    Edit
                  </Button>
                </ItemActions>
              </Item>
            </div>
          ))}
        </ItemGroup>
      )}
      <div>
        <Button variant="ghost" size="sm" startIcon={<PlusIcon />} onClick={() => setEditing('new')}>
          Add a role
        </Button>
      </div>
      {editing && (
        <RoleDialog
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
    </div>
  )
}

function ProjectDialog(props: { project: Project | null; onClose: () => void; onSave: (project: Project) => void; onDelete: (id: string) => void }): JSX.Element {
  const [project, setProject] = useState<Project>(props.project ?? { id: newId(), name: '', link: '', about: '' })
  const set = (patch: Partial<Project>): void => setProject(current => ({ ...current, ...patch }))
  return (
    <Dialog open onOpenChange={open => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.project ? 'Edit project' : 'Add a project'}</DialogTitle>
          <DialogDescription>Used as written, like your roles.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input id="project-name" value={project.name} onChange={event => set({ name: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-link">Public link</FieldLabel>
              <Input id="project-link" type="url" value={project.link} onChange={event => set({ link: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-about">What it is, and what you built</FieldLabel>
              <Textarea id="project-about" rows={5} value={project.about} onChange={event => set({ about: event.target.value })} />
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          {props.project && (
            <div className="nx:flex-1">
              <Button variant="ghost" startIcon={<TrashIcon />} onClick={() => props.onDelete(project.id)}>
                Delete project
              </Button>
            </div>
          )}
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!project.name.trim()} onClick={() => props.onSave(project)}>
            Save project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ProjectsList({ projects, onChange }: { projects: Project[]; onChange: (projects: Project[]) => void }): JSX.Element {
  const [editing, setEditing] = useState<Project | null | 'new'>(null)
  return (
    <div className="nx:flex nx:flex-col nx:gap-2">
      {projects.length === 0 ? (
        <span className="nx:typography-body-small nx:text-muted-foreground">No projects yet.</span>
      ) : (
        <ItemGroup>
          {projects.map(project => (
            <Item key={project.id} size="sm">
              <ItemContent>
                <ItemTitle>{project.name}</ItemTitle>
                <ItemDescription>{[project.about.split('\n')[0], project.link].filter(Boolean).join(' ')}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="ghost" size="sm" startIcon={<PencilSimpleIcon />} onClick={() => setEditing(project)}>
                  Edit
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <div>
        <Button variant="ghost" size="sm" startIcon={<PlusIcon />} onClick={() => setEditing('new')}>
          Add a project
        </Button>
      </div>
      {editing && (
        <ProjectDialog
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
    </div>
  )
}

/** One input per platform, plus any other links by name. */
export function LinksEditor({ links, onChange }: { links: ProfileLinks; onChange: (links: ProfileLinks) => void }): JSX.Element {
  const set = (patch: Partial<ProfileLinks>): void => onChange({ ...links, ...patch })
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="link-linkedin">LinkedIn</FieldLabel>
        <Input id="link-linkedin" type="url" placeholder="https://www.linkedin.com/in/" value={links.linkedin} onChange={event => set({ linkedin: event.target.value })} />
      </Field>
      <Field>
        <FieldLabel htmlFor="link-github">GitHub</FieldLabel>
        <Input id="link-github" type="url" placeholder="https://github.com/" value={links.github} onChange={event => set({ github: event.target.value })} />
      </Field>
      <Field>
        <FieldLabel htmlFor="link-site">Portfolio or website</FieldLabel>
        <Input id="link-site" type="url" placeholder="https://" value={links.site} onChange={event => set({ site: event.target.value })} />
      </Field>
      {links.other.map((link, i) => (
        <Field key={i}>
          <FieldLabel htmlFor={`link-other-${i}`}>{link.name || 'Another link'}</FieldLabel>
          <div className="nx:flex nx:flex-wrap nx:gap-2 nx:items-center">
            <div className="nx:min-w-0" style={{ flex: '1 1 100px' }}>
              <Input
                aria-label="Name"
                placeholder="Name, such as Behance"
                value={link.name}
                onChange={event => set({ other: links.other.map((one, j) => (j === i ? { ...one, name: event.target.value } : one)) })}
              />
            </div>
            <div className="nx:min-w-0" style={{ flex: '2 1 160px' }}>
              <Input
                id={`link-other-${i}`}
                type="url"
                placeholder="https://"
                value={link.url}
                onChange={event => set({ other: links.other.map((one, j) => (j === i ? { ...one, url: event.target.value } : one)) })}
              />
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Remove this link" onClick={() => set({ other: links.other.filter((_, j) => j !== i) })}>
              <TrashIcon />
            </Button>
          </div>
        </Field>
      ))}
      <div>
        <Button variant="ghost" size="sm" startIcon={<PlusIcon />} disabled={links.other.length >= 10} onClick={() => set({ other: [...links.other, { name: '', url: '' }] })}>
          Add another link
        </Button>
      </div>
      <FieldDescription>A form that asks for a profile link gets the one it names.</FieldDescription>
    </FieldGroup>
  )
}

/** The editable parts of a profile, shared by onboarding and Settings. */
export type ProfileSetter = (patch: Partial<Profile>) => void
