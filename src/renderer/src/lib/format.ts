import { PORTAL_NAMES } from '../../../shared/types'
import type { Portal } from '../../../shared/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number): string => String(n).padStart(2, '0')

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** "12 Nov", from a YYYY-MM-DD date or a timestamp. */
export function day(value: string | null | undefined): string {
  if (!value) return ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/** "10:42", from a timestamp. */
export function time(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** "Today 10:42", "Yesterday 17:40" or "10 Nov 09:05", from a timestamp. */
export function when(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const label = sameDay(date, now) ? 'Today' : sameDay(date, yesterday) ? 'Yesterday' : day(value)
  return `${label} ${time(value)}`
}

/** "1.6M", "151k" or "820". */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** "6 min", "1 min 20 s" or "40 s". */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes < 10 && rest ? `${minutes} min ${rest} s` : `${minutes} min`
}

/** A portal's display name; sources from before the app are tidied, not renamed. */
export function portalName(portal: string | null | undefined): string {
  if (!portal) return ''
  const key = portal.toLowerCase() as Portal
  if (key in PORTAL_NAMES) return PORTAL_NAMES[key]
  return portal.replace(/\b[a-z]/g, letter => letter.toUpperCase())
}

/** "Startup", from "startup". */
export const capitalize = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text)

/** "1 posting" or "3 postings". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
