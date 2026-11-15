import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import { ArrowSquareOutIcon, PencilSimpleIcon, PlusIcon } from '@phosphor-icons/react'

import { api, messageOf } from '../lib/api'
import { attempt } from './common'
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  Input,
  Kbd,
  Textarea,
} from './nx'

/** How to save, and what Enter and Esc do, while a value is open. */
function Keys(): JSX.Element {
  return (
    <span className="nx:flex nx:flex-wrap nx:items-center nx:gap-1 nx:px-2 nx:typography-body-small nx:text-muted-foreground">
      <Kbd>Enter</Kbd> saves <Kbd>Esc</Kbd> puts it back
    </span>
  )
}

function Problem({ text }: { text: string }): JSX.Element {
  return (
    <span role="alert" className="nx:px-2 nx:typography-body-small nx:text-error-subtle-foreground">
      {text}
    </span>
  )
}

/**
 * A value that edits where it is, never in a dialog: text at rest, a field
 * on a click (or Tab then typing). Enter or clicking away saves; Esc puts it
 * back. A value that can't be saved stays open with the reason under it, and
 * nothing changes until it is fixed or put back.
 */
export function InlineField(props: {
  /** The value as it is saved: "" for none. */
  value: string
  /** What shows at rest when it differs from the value, such as "3+ years" for 3. */
  display?: string
  /** Shown when there is no value. */
  placeholder: string
  label: string
  /** The field's type while it is open. */
  type?: 'text' | 'number' | 'url' | 'date'
  /** Beside the value while open, such as "+ years". */
  suffix?: string
  /** Why a value can't be saved, or null when it can. */
  check?: (value: string) => string | null
  onSave: (value: string) => Promise<unknown>
  /** The page's title. */
  heading?: boolean
  /** Beside the value at rest, such as the arrow that opens a link. */
  end?: ReactNode
  /** Under the value at rest, such as the posting's words. */
  below?: ReactNode
}): JSX.Element {
  // null while closed; the text being typed while open.
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const putBack = useRef(false)
  const isOpen = draft !== null

  const open = (): void => {
    if (draft !== null) return
    setDraft(props.value)
    setProblem(null)
  }

  const close = async (): Promise<void> => {
    if (draft === null) return
    if (putBack.current) {
      putBack.current = false
      setDraft(null)
      setProblem(null)
      return
    }
    const next = draft.trim()
    if (next === props.value.trim()) {
      setDraft(null)
      setProblem(null)
      return
    }
    const reason = props.check?.(next) ?? null
    if (reason) {
      setProblem(reason)
      return
    }
    setIsSaving(true)
    try {
      await props.onSave(next)
      setDraft(null)
      setProblem(null)
    } catch (error) {
      setProblem(messageOf(error))
    } finally {
      setIsSaving(false)
    }
  }

  const sizing = props.heading ? 'nx:typography-heading-large nx:h-auto nx:py-1 nx:-ml-2' : ''
  return (
    <div className="nx:flex nx:flex-col nx:gap-1 nx:min-w-0">
      <div className="nx:flex nx:items-center nx:gap-1 nx:min-w-0">
        <div className="nx:group nx:relative nx:flex-1 nx:min-w-0">
          <Input
            size="sm"
            variant="ghost"
            aria-label={props.label}
            aria-invalid={problem ? true : undefined}
            type={isOpen ? (props.type ?? 'text') : 'text'}
            placeholder={props.placeholder}
            value={isOpen ? draft : (props.display ?? props.value)}
            readOnly={isSaving}
            className={`nx:w-full nx:text-ellipsis ${props.suffix && isOpen ? 'nx:pr-16' : 'nx:pr-7'} ${sizing}`}
            onFocus={event => {
              open()
              const input = event.currentTarget
              // The whole value is picked, so typing replaces it.
              requestAnimationFrame(() => {
                if (input.type !== 'date' && input.type !== 'number') input.select()
              })
            }}
            onChange={event => {
              setDraft(event.target.value)
              if (problem) setProblem(null)
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                putBack.current = true
                event.currentTarget.blur()
              }
            }}
            onBlur={() => void close()}
          />
          {isOpen && props.suffix && (
            <span className="nx:absolute nx:right-2 nx:top-1/2 nx:-translate-y-1/2 nx:pointer-events-none nx:typography-body-small nx:text-muted-foreground">{props.suffix}</span>
          )}
          {!isOpen && (
            <PencilSimpleIcon
              size={14}
              aria-hidden="true"
              className="nx:absolute nx:right-2 nx:top-1/2 nx:-translate-y-1/2 nx:pointer-events-none nx:text-muted-foreground nx:opacity-0 nx:group-hover:opacity-100"
            />
          )}
        </div>
        {!isOpen && props.end}
      </div>
      {problem ? <Problem text={problem} /> : isOpen ? <Keys /> : props.below}
    </div>
  )
}

/** A link without its https:// and www., as it shows at rest. */
export const shortLink = (url: string): string => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

export const checkLink = (value: string): string | null => (!value || /^https?:\/\/\S+$/i.test(value) ? null : 'Paste the whole link, starting with https://')

/** A link that edits like text; the arrow beside it opens it, so a click on the words never leaves the app. */
export function InlineLink(props: { value: string; placeholder: string; label: string; onSave: (value: string) => Promise<unknown>; below?: ReactNode }): JSX.Element {
  return (
    <InlineField
      value={props.value}
      display={shortLink(props.value)}
      placeholder={props.placeholder}
      label={props.label}
      type="url"
      check={checkLink}
      onSave={props.onSave}
      below={props.below}
      end={
        props.value ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Open ${shortLink(props.value)}`} onClick={() => void attempt(() => api.chrome.openUrl(props.value))}>
            <ArrowSquareOutIcon />
          </Button>
        ) : undefined
      }
    />
  )
}

/** A whole number from `min` to `max`, or empty when `optional`. */
export function checkNumber(min: number, max: number, what: string): (value: string) => string | null {
  return value => (value === '' || (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max) ? null : `${what} is ${min} to ${max}`)
}

/**
 * The company a job is at, picked from your companies or typed as a new one.
 * Moving a job keeps its asks with it; people stay where they work.
 */
export function InlineCompany({ value, onSave }: { value: string; onSave: (name: string) => Promise<unknown> }): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [names, setNames] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    void api.companies.names().then(setNames).catch(() => undefined)
  }, [isOpen])
  const typed = query.trim()
  const isKnown = names.some(one => one.name.toLowerCase() === typed.toLowerCase())
  const pick = (name: string): void => {
    setIsOpen(false)
    if (name !== value) void attempt(() => onSave(name), `Moved to ${name}`)
  }
  return (
    <Combobox open={isOpen} onOpenChange={setIsOpen}>
      <ComboboxTrigger variant="ghost" size="sm" aria-label={`Company: ${value}. Move to another company`} className="nx:font-normal nx:typography-body-small nx:px-2">
        <span className="nx:truncate">{value}</span>
      </ComboboxTrigger>
      <ComboboxContent label="Company">
        <ComboboxInput placeholder="Find or add a company" value={query} onValueChange={setQuery} />
        <ComboboxList>
          <ComboboxEmpty>No company by that name</ComboboxEmpty>
          <ComboboxGroup>
            {names.map(one => (
              <ComboboxItem key={one.id} value={`${one.id}`} keywords={[one.name]} selected={one.name === value} onSelect={() => pick(one.name)}>
                {one.name}
              </ComboboxItem>
            ))}
          </ComboboxGroup>
          {typed && !isKnown && (
            <>
              <ComboboxSeparator />
              <ComboboxGroup>
                <ComboboxItem value={`new:${typed}`} keywords={[typed]} onSelect={() => pick(typed)}>
                  <PlusIcon />
                  New company "{typed}"
                </ComboboxItem>
              </ComboboxGroup>
            </>
          )}
        </ComboboxList>
        <span className="nx:block nx:px-3 nx:py-2 nx:border-t-default nx:border-border-default nx:typography-body-small nx:text-muted-foreground">Asks stay with this job. People stay where they work.</span>
      </ComboboxContent>
    </Combobox>
  )
}

/** The key held with Enter to save notes: ⌘ on a Mac, Ctrl elsewhere. */
const SAVE_KEY = /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'

/**
 * Notes that read as text and become a text box when clicked (or on Enter).
 * Enter starts a new line; clicking away or ⌘ Enter saves; Esc puts them back.
 */
export function InlineNotes(props: { value: string; placeholder: string; label: string; onSave: (value: string) => Promise<unknown> }): JSX.Element {
  // null while closed; the text being typed while open.
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const putBack = useRef(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const isOpen = draft !== null

  // Opened by a click: the box takes the focus, with the caret after the last word.
  useEffect(() => {
    const area = box.current
    if (!isOpen || !area || document.activeElement === area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [isOpen])

  const open = (): void => {
    setDraft(props.value)
    setProblem(null)
  }

  const close = async (): Promise<void> => {
    if (draft === null) return
    const next = draft.replace(/\s+$/, '')
    if (putBack.current || next === props.value.replace(/\s+$/, '')) {
      putBack.current = false
      setDraft(null)
      setProblem(null)
      return
    }
    try {
      await props.onSave(next)
      setDraft(null)
      setProblem(null)
    } catch (error) {
      setProblem(messageOf(error))
    }
  }

  if (isOpen) {
    return (
      <div className="nx:flex nx:flex-col nx:gap-1">
        <Textarea
          ref={box}
          aria-label={props.label}
          aria-invalid={problem ? true : undefined}
          rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
          placeholder={props.placeholder}
          value={draft}
          onChange={event => {
            setDraft(event.target.value)
            if (problem) setProblem(null)
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              putBack.current = true
              event.currentTarget.blur()
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
          onBlur={() => void close()}
        />
        {problem ? (
          <Problem text={problem} />
        ) : (
          <span className="nx:flex nx:flex-wrap nx:items-center nx:gap-1 nx:typography-body-small nx:text-muted-foreground">
            Clicking away or <Kbd>{SAVE_KEY} Enter</Kbd> saves <Kbd>Esc</Kbd> puts it back
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${props.label}. Click to edit`}
      onClick={open}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      className="nx:group nx:relative nx:box-border nx:w-full nx:rounded-md nx:border-default nx:border-transparent nx:hover:border-border-default nx:focus-visible:outline-default nx:focus-visible:outline-focus-default nx:px-3 nx:py-2 nx:pr-8 nx:typography-body-default nx:whitespace-pre-wrap nx:break-words nx:cursor-text"
    >
      {props.value.trim() ? props.value : <span className="nx:text-muted-foreground">{props.placeholder}</span>}
      <PencilSimpleIcon size={14} aria-hidden="true" className="nx:absolute nx:right-2 nx:top-2.5 nx:pointer-events-none nx:text-muted-foreground nx:opacity-0 nx:group-hover:opacity-100" />
    </div>
  )
}
