import { useState } from 'react'
import type { JSX } from 'react'

import { InfoIcon, PlusIcon } from '@phosphor-icons/react'

import type { Stage } from '../../../shared/types'
import { api } from '../lib/api'
import { go } from '../lib/router'
import { attempt, Page } from '../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardFooter,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '../ui/nx'

/** A row the hunt didn't find: a recruiter who called, a role a friend sent, an application made by hand. */
export function TrackerAdd(): JSX.Element {
  const [form, setForm] = useState({
    company: '',
    role: '',
    stage: 'scaleup' as Stage,
    portal: '',
    status: 'applied',
    link: '',
    mode: '',
    notes: '',
  })
  const set = (patch: Partial<typeof form>): void => setForm(current => ({ ...current, ...patch }))

  const add = async (): Promise<void> => {
    const rowId = await attempt(() => api.tracker.add(form), 'Row added')
    if (rowId) go(`/opportunity/${rowId}`)
  }

  return (
    <Page
      narrow
      back={{ label: 'Tracker', to: '/tracker' }}
      title="Add a row"
      description="For an opportunity the hunt didn't find: a recruiter who called, a role a friend sent, an application you made yourself."
    >
      <Card>
        <CardContent>
          <FieldGroup>
            <div className="nx:flex nx:flex-wrap nx:gap-4">
              <div className="nx:min-w-0" style={{ flex: '1 1 240px' }}>
                <Field>
                  <FieldLabel htmlFor="add-company">Company</FieldLabel>
                  <Input id="add-company" value={form.company} onChange={event => set({ company: event.target.value })} />
                  <FieldDescription>A recruiter's undisclosed client: "Undisclosed (via firm)". Rename it once the client is known.</FieldDescription>
                </Field>
              </div>
              <div className="nx:min-w-0" style={{ flex: '1 1 240px' }}>
                <Field>
                  <FieldLabel htmlFor="add-role">Role</FieldLabel>
                  <Input id="add-role" value={form.role} onChange={event => set({ role: event.target.value })} />
                </Field>
              </div>
            </div>
            <div className="nx:flex nx:flex-wrap nx:gap-4">
              <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
                <Field>
                  <FieldLabel htmlFor="add-stage">Stage</FieldLabel>
                  <NativeSelect id="add-stage" value={form.stage} onChange={event => set({ stage: event.target.value as Stage })}>
                    <NativeSelectOption value="startup">Startup, under about 150 people</NativeSelectOption>
                    <NativeSelectOption value="scaleup">Scaleup, about 150 to 1,000</NativeSelectOption>
                    <NativeSelectOption value="large">Large, over 1,000 or public</NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>Not known yet? Scaleup, and correct it later.</FieldDescription>
                </Field>
              </div>
              <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
                <Field>
                  <FieldLabel htmlFor="add-source">Where it came from</FieldLabel>
                  <Input id="add-source" placeholder="Recruiter call" value={form.portal} onChange={event => set({ portal: event.target.value })} />
                </Field>
              </div>
              <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
                <Field>
                  <FieldLabel htmlFor="add-status">Status</FieldLabel>
                  <NativeSelect id="add-status" value={form.status} onChange={event => set({ status: event.target.value })}>
                    <NativeSelectOption value="found">Found, not applied yet</NativeSelectOption>
                    <NativeSelectOption value="applied">Applied</NativeSelectOption>
                    <NativeSelectOption value="screen">Screen</NativeSelectOption>
                  </NativeSelect>
                </Field>
              </div>
            </div>
            <div className="nx:flex nx:flex-wrap nx:gap-4">
              <div className="nx:min-w-0" style={{ flex: '2 1 300px' }}>
                <Field>
                  <FieldLabel htmlFor="add-link">Posting link</FieldLabel>
                  <Input id="add-link" type="url" placeholder="https://" value={form.link} onChange={event => set({ link: event.target.value })} />
                  <FieldDescription>Optional. With a link, Apply can work the row.</FieldDescription>
                </Field>
              </div>
              <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
                <Field>
                  <FieldLabel htmlFor="add-mode">Work mode</FieldLabel>
                  <Input id="add-mode" placeholder="Remote" value={form.mode} onChange={event => set({ mode: event.target.value })} />
                </Field>
              </div>
            </div>
            <Field>
              <FieldLabel htmlFor="add-notes">Notes</FieldLabel>
              <Textarea id="add-notes" rows={4} value={form.notes} onChange={event => set({ notes: event.target.value })} />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <div className="nx:flex nx:flex-wrap nx:gap-2">
            <Button startIcon={<PlusIcon />} onClick={() => void add()}>
              Add row
            </Button>
            <Button variant="outline" onClick={() => go('/tracker')}>
              Cancel
            </Button>
          </div>
        </CardFooter>
      </Card>
      <Alert variant="information" layout="inline">
        <AlertIcon>
          <InfoIcon />
        </AlertIcon>
        <AlertContent>
          <AlertTitle>One route per role</AlertTitle>
          <AlertDescription>If the same company and role is already tracked, the app says so instead of adding a second row.</AlertDescription>
        </AlertContent>
      </Alert>
    </Page>
  )
}
