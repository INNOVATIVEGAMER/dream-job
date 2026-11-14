import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { LinkIcon } from '@phosphor-icons/react'

import { SOURCE_NAMES, SOURCES, STATUS_NAMES, STATUSES, WORK_MODE_NAMES, WORK_MODES } from '../../../shared/types'
import type { NewJob, Source, Stage, Status, WorkMode } from '../../../shared/types'
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
  FieldDescription,
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
// A job you add was not ruled out by a hunt, so it can be anything but discarded.
const STATUS_OPTIONS = STATUSES.filter(status => status !== 'discarded').map(status => ({ value: status, label: STATUS_NAMES[status] }))
const SOURCE_OPTIONS = SOURCES.map(source => ({ value: source, label: SOURCE_NAMES[source] }))
const MODE_OPTIONS = WORK_MODES.map(mode => ({ value: mode, label: WORK_MODE_NAMES[mode] }))

const EMPTY: NewJob = { company: '', stage: 'scaleup', role: '', link: '', reqId: '', status: 'applied', portal: 'manual', workMode: 'not-stated', notes: '' }

/** A job the hunt didn't find: a recruiter who called, a role a friend sent. Opens the job once added. */
export function AddJobDialog({ open, onOpenChange, company }: { open: boolean; onOpenChange: (open: boolean) => void; company?: string }): JSX.Element {
  const [form, setForm] = useState<NewJob>(EMPTY)
  const [names, setNames] = useState<string[]>([])
  const set = (patch: Partial<NewJob>): void => setForm(current => ({ ...current, ...patch }))

  useEffect(() => {
    if (!open) return
    setForm({ ...EMPTY, company: company ?? '' })
    void api.companies.names().then(list => setNames(list.map(one => one.name))).catch(() => undefined)
  }, [open, company])

  const isNew = form.company.trim() !== '' && !names.some(name => name.toLowerCase() === form.company.trim().toLowerCase())
  const canAdd = !!form.company.trim() && !!form.role.trim() && !!form.link.trim()
  const add = async (): Promise<void> => {
    const id = await attempt(() => api.tracker.add({ ...form, link: form.link.trim(), reqId: form.reqId.trim() }), 'Job added')
    if (id) {
      onOpenChange(false)
      go(`/job/${id}`)
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
                    Stage <Tip text="Saved on the company, asked once for a new one. Not sure? Scaleup, and change it later." />
                  </FieldLabel>
                  <Choice id="add-stage" value={form.stage} options={STAGE_OPTIONS} onChange={stage => set({ stage: stage as Stage })} />
                </Field>
              )}
            </div>
            <div className="nx:grid nx:gap-3" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
              <Field>
                <FieldLabel htmlFor="add-role">Role</FieldLabel>
                <Input id="add-role" value={form.role} onChange={event => set({ role: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="add-mode">Work mode</FieldLabel>
                <Choice id="add-mode" value={form.workMode ?? 'not-stated'} options={MODE_OPTIONS} onChange={workMode => set({ workMode: workMode as WorkMode })} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="add-link">Link</FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <LinkIcon />
                </InputGroupAddon>
                <InputGroupInput id="add-link" type="url" required aria-required placeholder="https://" value={form.link} onChange={event => set({ link: event.target.value })} />
              </InputGroup>
              <FieldDescription>Required: the posting, or the company's apply page</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="add-req">Job ID</FieldLabel>
              <Input id="add-req" placeholder="R-20431" value={form.reqId} onChange={event => set({ reqId: event.target.value })} />
              <FieldDescription>Optional. The company's own ID from the posting; referral messages include it</FieldDescription>
            </Field>
            <div className="nx:grid nx:gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <Field>
                <FieldLabel htmlFor="add-status">Status</FieldLabel>
                <Choice id="add-status" value={form.status} options={STATUS_OPTIONS} onChange={status => set({ status: status as Status })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="add-portal">Portal</FieldLabel>
                <Choice id="add-portal" value={form.portal} options={SOURCE_OPTIONS} onChange={portal => set({ portal: portal as Source })} />
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
          <Button disabled={!canAdd} onClick={() => void add()}>
            Add job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
