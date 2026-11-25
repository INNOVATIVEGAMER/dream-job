import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import { answerOf, isMissing, isPending } from '../../../../shared/form'
import type { FormField } from '../../../../shared/types'
import { api } from '../../lib/api'
import { attempt } from '../../ui/common'
import { Badge, Button, Field, FieldLabel, FieldRequiredIndicator, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner, Switch, Textarea } from '../../ui/nx'

/** How long after the last key an answer you are typing is handed over. */
const TYPING_MS = 700

/** Answers typed and not yet handed to the main process: sending the application waits for them. */
const unsaved = new Set<() => Promise<void>>()

/** Hands over every answer still being typed. */
export const flushForm = async (): Promise<void> => {
  await Promise.all([...unsaved].map(save => save()))
}

type Waiting = { value: string; timer: ReturnType<typeof setTimeout> | null; isSending: boolean }

/**
 * One answer as you edit it. It follows the form, except while you type: what
 * you typed is handed over a moment after you stop, or at once for a choice,
 * and the form's own value never overwrites it on the way.
 */
function useAnswer(laneKey: string, field: FormField): { draft: string; change: (value: string, isTyped: boolean) => void; flush: () => Promise<void> } {
  const held = answerOf(field)
  const [draft, setDraft] = useState(held)
  const waiting = useRef<Waiting | null>(null)

  const flush = useCallback(async (): Promise<void> => {
    const mine = waiting.current
    if (!mine || mine.isSending) return
    if (mine.timer) clearTimeout(mine.timer)
    mine.isSending = true
    await attempt(() => api.runs.setField(laneKey, field.key, mine.value))
    if (waiting.current === mine) waiting.current = null
  }, [laneKey, field.key])

  useEffect(() => {
    if (!waiting.current) setDraft(held)
  }, [held])

  useEffect(() => {
    unsaved.add(flush)
    return () => {
      unsaved.delete(flush)
      void flush()
    }
  }, [flush])

  const change = (value: string, isTyped: boolean): void => {
    setDraft(value)
    if (waiting.current?.timer) clearTimeout(waiting.current.timer)
    waiting.current = { value, timer: isTyped ? setTimeout(() => void flush(), TYPING_MS) : null, isSending: false }
    if (!isTyped) void flush()
  }

  return { draft, change, flush }
}

/** A field you can't change here, or a form already sent: the answer as text. */
function Held({ field }: { field: FormField }): JSX.Element {
  const answer = answerOf(field)
  if (!answer.trim()) return <span className="nx:typography-body-small nx:text-muted-foreground">{field.kind === 'file' ? 'No file' : 'Left empty'}</span>
  return <span className="nx:typography-body-default nx:whitespace-pre-wrap nx:break-words">{answer}</span>
}

function Control({ field, laneKey, id }: { field: FormField; laneKey: string; id: string }): JSX.Element {
  const { draft, change, flush } = useAnswer(laneKey, field)
  switch (field.kind) {
    case 'longtext':
      return <Textarea id={id} rows={Math.min(12, Math.max(3, Math.ceil(draft.length / 80)))} value={draft} onChange={event => change(event.target.value, true)} onBlur={() => void flush()} />
    case 'select':
    case 'radio': {
      // What it holds is always a choice, even when the page words it apart from the list.
      const options = [...new Set([...(field.options ?? []), draft].filter(Boolean))]
      return (
        <Select value={draft} onValueChange={value => change(value, false)}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Not answered" />
          </SelectTrigger>
          <SelectContent>
            {options.map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    case 'checkbox':
      return <Switch id={id} size="sm" checked={draft === 'Yes'} onCheckedChange={isOn => change(isOn ? 'Yes' : 'No', false)} />
    default:
      return <Input id={id} value={draft} onChange={event => change(event.target.value, true)} onBlur={() => void flush()} />
  }
}

/** Where a field's answer came from, and where your own answer stands on the page. */
function Standing({ field, laneKey, canEdit }: { field: FormField; laneKey: string; canEdit: boolean }): JSX.Element | null {
  const marks: ReactNode[] = []
  if (field.isWritten) {
    marks.push(
      <Badge key="written" variant="information" fill="light" isCaps={false}>
        Written for you
      </Badge>,
    )
  }
  if (field.wanted !== null) {
    marks.push(
      <Badge key="by" variant="secondary" fill="light" isCaps={false}>
        {field.by === 'chat' ? 'Changed in chat' : 'Changed by you'}
      </Badge>,
    )
  }
  if (canEdit && isMissing(field)) {
    marks.push(
      <Badge key="missing" variant="warning" fill="light" isCaps={false}>
        Required, and empty
      </Badge>,
    )
  }
  if (canEdit && field.isStuck) {
    marks.push(
      <span key="stuck" className="nx:flex nx:items-center nx:gap-2 nx:typography-body-small nx:text-warning-subtle-foreground">
        The form kept {field.value.trim() ? `"${field.value}"` : 'it empty'}.
        <Button variant="outline" size="sm" onClick={() => void attempt(() => api.runs.setField(laneKey, field.key, null))}>
          Keep that
        </Button>
      </span>,
    )
  } else if (canEdit && isPending(field)) {
    marks.push(
      <span key="pending" className="nx:flex nx:items-center nx:gap-1.5 nx:typography-body-small nx:text-muted-foreground">
        <Spinner />
        {field.isOnPage ? 'Going into the form' : 'On another page: Claude sets it before it is sent'}
      </span>,
    )
  }
  if (marks.length === 0) return null
  return <div className="nx:flex nx:flex-wrap nx:items-center nx:gap-2">{marks}</div>
}

function Row({ field, laneKey, canEdit }: { field: FormField; laneKey: string; canEdit: boolean }): JSX.Element {
  const id = `form-${laneKey}-${field.key}`
  const isEditable = canEdit && !field.isReadOnly && field.kind !== 'file'
  const isSwitch = isEditable && field.kind === 'checkbox'
  const label = (
    <FieldLabel htmlFor={isEditable ? id : undefined}>
      {field.label}
      {field.isRequired && <FieldRequiredIndicator />}
    </FieldLabel>
  )
  return (
    <Field>
      {isSwitch ? (
        <div className="nx:flex nx:items-start nx:gap-3">
          <Control field={field} laneKey={laneKey} id={id} />
          {label}
        </div>
      ) : (
        <>
          {label}
          {isEditable ? <Control field={field} laneKey={laneKey} id={id} /> : <Held field={field} />}
        </>
      )}
      <Standing field={field} laneKey={laneKey} canEdit={canEdit} />
    </Field>
  )
}

/**
 * An application's form, whole: every question the page asked, over every
 * page, with the answer each goes out with. While its session runs you change
 * any answer here, and the app sets it in Chrome; once it is sent, or in a
 * past run or on the job, it is the record of what went.
 */
export function FormView({ fields, laneKey = '', canEdit = false, shownPage = 0 }: { fields: FormField[]; laneKey?: string; canEdit?: boolean; shownPage?: number }): JSX.Element {
  if (fields.length === 0) return <span className="nx:typography-body-small nx:text-muted-foreground">There was no form to fill.</span>
  const pages = [...new Set(fields.map(field => field.page))].sort((a, b) => a - b)
  return (
    <div className="nx:flex nx:flex-col nx:gap-6">
      {pages.map(page => (
        <div key={page} className="nx:flex nx:flex-col nx:gap-5">
          {pages.length > 1 && (
            <span className="nx:typography-label-default nx:text-muted-foreground">
              Page {page}
              {canEdit && page === shownPage ? ' · in Chrome now' : ''}
            </span>
          )}
          {fields
            .filter(field => field.page === page)
            .map(field => (
              <Row key={field.key} field={field} laneKey={laneKey} canEdit={canEdit} />
            ))}
        </div>
      ))}
    </div>
  )
}
