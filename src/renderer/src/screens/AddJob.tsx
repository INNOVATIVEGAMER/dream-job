import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { LinkIcon } from '@phosphor-icons/react'

import type { Stage } from '../../../shared/types'
import { api } from '../lib/api'
import { go } from '../lib/router'
import { attempt, Tip } from '../ui/common'
import { Choice, NamePicker } from '../ui/fields'
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
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
  Textarea,
} from '../ui/nx'

const STAGE_OPTIONS = [
  { value: 'startup', label: 'Startup' },
  { value: 'scaleup', label: 'Scaleup' },
  { value: 'large', label: 'Large' },
]
const STATUS_OPTIONS = [
  { value: 'found', label: 'Found' },
  { value: 'applied', label: 'Applied' },
  { value: 'replied', label: 'Replied' },
  { value: 'screen', label: 'Screen' },
  { value: 'onsite', label: 'Onsite' },
]
const SOURCE_OPTIONS = [
  { value: 'LinkedIn', label: 'LinkedIn' },
  { value: 'Wellfound', label: 'Wellfound' },
  { value: 'Instahyre', label: 'Instahyre' },
  { value: 'Other', label: 'Other' },
]

const EMPTY = { company: '', role: '', stage: 'scaleup' as Stage, portal: 'Other', status: 'applied', link: '', mode: '', notes: '' }

/** A job the hunt didn't find: a recruiter who called, a role a friend sent. Opens the job once added. */
export function AddJobDialog({ open, onOpenChange, company }: { open: boolean; onOpenChange: (open: boolean) => void; company?: string }): JSX.Element {
  const [form, setForm] = useState(EMPTY)
  const [names, setNames] = useState<string[]>([])
  const set = (patch: Partial<typeof form>): void => setForm(current => ({ ...current, ...patch }))

  useEffect(() => {
    if (!open) return
    setForm({ ...EMPTY, company: company ?? '' })
    void api.companies.names().then(list => setNames(list.map(one => one.name))).catch(() => undefined)
  }, [open, company])

  const isNew = form.company.trim() !== '' && !names.some(name => name.toLowerCase() === form.company.trim().toLowerCase())
  const add = async (): Promise<void> => {
    const rowId = await attempt(() => api.tracker.add(form), 'Job added')
    if (rowId) {
      onOpenChange(false)
      go(`/opportunity/${rowId}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a job</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <div className="nx:grid nx:gap-3" style={{ gridTemplateColumns: isNew ? 'minmax(0, 2fr) minmax(0, 1fr)' : '1fr' }}>
              <Field>
                <FieldLabel htmlFor="add-company">Company</FieldLabel>
                <NamePicker id="add-company" value={form.company} names={names} onChange={name => set({ company: name })} placeholder="Find or add a company" />
              </Field>
              {isNew && (
                <Field>
                  <FieldLabel htmlFor="add-stage">
                    Stage <Tip text="Asked once, for a new company. Not sure? Scaleup, and change it later." />
                  </FieldLabel>
                  <Choice id="add-stage" value={form.stage} options={STAGE_OPTIONS} onChange={stage => set({ stage: stage as Stage })} />
                </Field>
              )}
            </div>
            <Field>
              <FieldLabel htmlFor="add-role">Role</FieldLabel>
              <Input id="add-role" value={form.role} onChange={event => set({ role: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-link">Link</FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <LinkIcon />
                </InputGroupAddon>
                <InputGroupInput id="add-link" type="url" placeholder="https://" value={form.link} onChange={event => set({ link: event.target.value })} />
              </InputGroup>
            </Field>
            <div className="nx:grid nx:gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <Field>
                <FieldLabel htmlFor="add-status">Status</FieldLabel>
                <Choice id="add-status" value={form.status} options={STATUS_OPTIONS} onChange={status => set({ status })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="add-source">Source</FieldLabel>
                <Choice id="add-source" value={form.portal} options={SOURCE_OPTIONS} onChange={portal => set({ portal })} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="add-notes">Notes</FieldLabel>
              <Textarea id="add-notes" rows={3} placeholder="A recruiter called about this role" value={form.notes} onChange={event => set({ notes: event.target.value })} />
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!form.company.trim() || !form.role.trim()} onClick={() => void add()}>
            Add job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
