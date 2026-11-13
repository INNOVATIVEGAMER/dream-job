import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

import { CaretUpDownIcon, CheckIcon, PlusIcon, XIcon } from '@phosphor-icons/react'

import {
  Badge,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from './nx'
import { Tip } from './common'

export type Option = { value: string; label: string }

/** One value from a short list: the nxds Select. */
export function Choice(props: {
  id?: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  ariaLabel?: string
  size?: 'default' | 'sm'
  variant?: 'bordered' | 'borderless'
  disabled?: boolean
  className?: string
}): JSX.Element {
  return (
    <Select value={props.value} onValueChange={props.onChange} disabled={props.disabled}>
      <SelectTrigger id={props.id} aria-label={props.ariaLabel} size={props.size ?? 'default'} variant={props.variant} className={props.className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A few fixed options side by side: the nxds ToggleGroup, one value. */
export function Segments(props: { value: string; options: Option[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean }): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={props.ariaLabel}
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value: string) => value && props.onChange(value)}
    >
      {props.options.map(option => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Several of a few fixed options: the nxds ToggleGroup, many values. */
export function MultiSegments(props: { values: string[]; options: Option[]; onChange: (values: string[]) => void; ariaLabel: string }): JSX.Element {
  return (
    <ToggleGroup type="multiple" variant="outline" size="sm" aria-label={props.ariaLabel} value={props.values} onValueChange={(values: string[]) => props.onChange(values)}>
      {props.options.map(option => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

const TRIGGER =
  'nx:flex nx:w-full nx:min-h-9 nx:items-center nx:gap-2 nx:px-3 nx:py-1 nx:text-left nx:rounded-md nx:border-default nx:border-border-default nx:bg-container nx:typography-body-default nx:text-foreground nx:cursor-pointer'

/**
 * A name picked from a list or typed new: the company field. Typing a name
 * no company has offers to add it.
 */
export function NamePicker(props: { id?: string; value: string; names: string[]; onChange: (value: string) => void; placeholder: string; ariaLabel?: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const typed = search.trim()
  const isNew = typed && !props.names.some(name => name.toLowerCase() === typed.toLowerCase())
  const pick = (name: string): void => {
    props.onChange(name)
    setSearch('')
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" id={props.id} aria-label={props.ariaLabel} className={TRIGGER}>
          <span className={`nx:flex-1 nx:truncate ${props.value ? '' : 'nx:text-muted-foreground'}`}>{props.value || props.placeholder}</span>
          <CaretUpDownIcon size={14} className="nx:text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="nx:w-(--radix-popover-trigger-width) nx:min-w-64 nx:p-0">
        <Command>
          <CommandInput placeholder="Find or add" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{typed ? null : 'Type a name.'}</CommandEmpty>
            {isNew && (
              <CommandGroup>
                <CommandItem value={`add ${typed}`} onSelect={() => pick(typed)}>
                  <PlusIcon />
                  <span>Add {typed}</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {props.names.map(name => (
                <CommandItem key={name} value={name} onSelect={() => pick(name)}>
                  <CheckIcon className={name === props.value ? '' : 'nx:opacity-0'} />
                  <span>{name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Several values shown as chips, picked from suggestions or typed new:
 * roles, cities, skills. A chip's x removes it.
 */
export function Tags(props: { id?: string; values: string[]; suggestions?: string[]; onChange: (values: string[]) => void; placeholder: string; ariaLabel?: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const typed = search.trim()
  const has = (value: string): boolean => props.values.some(one => one.toLowerCase() === value.toLowerCase())
  const options = [...props.values, ...(props.suggestions ?? []).filter(one => !has(one))]
  const isNew = typed && !options.some(one => one.toLowerCase() === typed.toLowerCase())
  const toggle = (value: string): void => {
    props.onChange(has(value) ? props.values.filter(one => one.toLowerCase() !== value.toLowerCase()) : [...props.values, value])
    setSearch('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div role="button" tabIndex={0} id={props.id} aria-label={props.ariaLabel} className={`${TRIGGER} nx:flex-wrap`}>
          {props.values.length === 0 && <span className="nx:flex-1 nx:text-muted-foreground">{props.placeholder}</span>}
          {props.values.map(value => (
            <Badge
              key={value}
              variant="secondary"
              fill="outline"
              isCaps={false}
              rightIcon={
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove ${value}`}
                  className="nx:inline-flex nx:cursor-pointer"
                  onClick={event => {
                    event.stopPropagation()
                    toggle(value)
                  }}
                >
                  <XIcon size={10} />
                </span>
              }
            >
              {value}
            </Badge>
          ))}
          <span className="nx:flex-1" />
          <CaretUpDownIcon size={14} className="nx:text-muted-foreground" />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="nx:w-(--radix-popover-trigger-width) nx:min-w-64 nx:p-0">
        <Command>
          <CommandInput placeholder="Find or add" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{typed ? null : 'Type to add one.'}</CommandEmpty>
            {isNew && (
              <CommandGroup>
                <CommandItem value={`add ${typed}`} onSelect={() => toggle(typed)}>
                  <PlusIcon />
                  <span>Add {typed}</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map(option => (
                <CommandItem key={option} value={option} onSelect={() => toggle(option)}>
                  <CheckIcon className={has(option) ? '' : 'nx:opacity-0'} />
                  <span>{option}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Settings as rows: the label on the left, the control on the right, one per
 * line, in one bordered box. A tip carries what used to be a description.
 */
export function Rows({ title, items }: { title?: string; items: { label: string; control: ReactNode; tip?: string; id?: string }[] }): JSX.Element {
  const box = (
    <div className="nx:rounded-md nx:border-default nx:border-border-default">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`nx:grid nx:items-center nx:gap-4 nx:px-4 nx:py-3 nx:min-h-13 nx:box-border ${i < items.length - 1 ? 'nx:border-b-default nx:border-border-default' : ''}`}
          style={{ gridTemplateColumns: '200px minmax(0, 1fr)' }}
        >
          <div className="nx:flex nx:items-center nx:gap-1">
            <label htmlFor={item.id} className="nx:typography-label-default">
              {item.label}
            </label>
            {item.tip && <Tip text={item.tip} />}
          </div>
          <div className="nx:min-w-0">{item.control}</div>
        </div>
      ))}
    </div>
  )
  if (!title) return box
  return (
    <section className="nx:flex nx:flex-col nx:gap-2">
      <span className="nx:typography-label-caps nx:text-muted-foreground">{title}</span>
      {box}
    </section>
  )
}

/** A list in one bordered box: roles, accounts, portals. */
export function ListBox({ children, label }: { children: ReactNode; label?: string }): JSX.Element {
  return (
    <div role="list" aria-label={label} className="nx:rounded-md nx:border-default nx:border-border-default nx:overflow-hidden">
      {children}
    </div>
  )
}

/** One line of a ListBox: an optional icon or control, a title over a detail, and actions on the right. */
export function ListRow(props: { media?: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode; onClick?: () => void }): JSX.Element {
  return (
    <div
      role="listitem"
      className={`nx:group nx:flex nx:items-center nx:gap-3 nx:px-4 nx:py-3 nx:min-h-13 nx:box-border nx:border-b-default nx:border-border-default nx:last:border-b-0 ${props.onClick ? 'nx:cursor-pointer nx:hover:bg-muted' : ''}`}
      onClick={props.onClick}
    >
      {props.media && <span className="nx:inline-flex nx:shrink-0 nx:text-muted-foreground">{props.media}</span>}
      <div className="nx:flex nx:flex-col nx:flex-1 nx:min-w-0">
        <span className="nx:typography-label-default nx:truncate">{props.title}</span>
        {props.detail && <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{props.detail}</span>}
      </div>
      {props.actions && (
        <div className="nx:flex nx:items-center nx:gap-2 nx:shrink-0" onClick={event => event.stopPropagation()}>
          {props.actions}
        </div>
      )}
    </div>
  )
}

/** A control pushed to the right edge of its row, such as a switch. */
export function End({ children }: { children: ReactNode }): JSX.Element {
  return <div className="nx:flex nx:justify-end">{children}</div>
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A month and year, as YYYY-MM: two nxds Selects side by side. */
export function MonthPicker(props: { id?: string; value: string; onChange: (value: string) => void; disabled?: boolean; ariaLabel: string }): JSX.Element {
  const [year = '', month = ''] = props.value ? props.value.split('-') : []
  const now = new Date().getFullYear()
  const years = Array.from({ length: 40 }, (_, i) => String(now - i))
  const set = (nextYear: string, nextMonth: string): void => props.onChange(nextYear && nextMonth ? `${nextYear}-${nextMonth}` : nextYear ? `${nextYear}-01` : '')
  return (
    <div className="nx:grid nx:gap-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <Select value={month || undefined} onValueChange={next => set(year || String(now), next)} disabled={props.disabled}>
        <SelectTrigger id={props.id} aria-label={`${props.ariaLabel}, month`}>
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent>
          {MONTHS.map((name, i) => (
            <SelectItem key={name} value={String(i + 1).padStart(2, '0')}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={year || undefined} onValueChange={next => set(next, month || '01')} disabled={props.disabled}>
        <SelectTrigger aria-label={`${props.ariaLabel}, year`}>
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent>
          {years.map(one => (
            <SelectItem key={one} value={one}>
              {one}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
