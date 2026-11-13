import { useCallback, useEffect, useRef, useState } from 'react'

import { toast } from '../ui/nx'
import { messageOf } from './api'

/** Equal once every string is trimmed, as the main process saves them. */
const key = (value: unknown): string => JSON.stringify(value, (_, one: unknown) => (typeof one === 'string' ? one.trim() : one))

type Options<T> = {
  ms?: number
  /** False while the saved value is still loading: nothing is saved yet. */
  isReady?: boolean
  /** Holds back a value the main process would refuse. */
  isValid?: (value: T) => boolean
}

/**
 * A value the user edits that saves itself a moment after they stop, with no
 * Save button. It follows the saved value when that changes elsewhere, saves
 * whatever is pending when the screen closes, and toasts a refused save.
 */
export function useAutosaved<T>(saved: T, save: (value: T) => Promise<unknown>, options: Options<T> = {}): [T, (next: T | ((current: T) => T)) => void] {
  const { ms = 700, isReady = true } = options
  const [value, setValue] = useState<T>(saved)
  const last = useRef(key(saved))
  const current = useRef(value)
  const latest = useRef({ save, isValid: options.isValid, isReady })
  latest.current = { save, isValid: options.isValid, isReady }

  const flush = useCallback((next: T): void => {
    const { save: send, isValid, isReady: ready } = latest.current
    if (!ready || key(next) === last.current || (isValid && !isValid(next))) return
    last.current = key(next)
    void send(next).catch((error: unknown) => toast.error(messageOf(error)))
  }, [])

  // Saved elsewhere, or loaded: show it.
  const savedKey = key(saved)
  useEffect(() => {
    if (savedKey === last.current) return
    last.current = savedKey
    current.current = saved
    setValue(saved)
  }, [savedKey])

  useEffect(() => {
    current.current = value
    if (key(value) === last.current) return
    const timer = setTimeout(() => flush(value), ms)
    return () => clearTimeout(timer)
  }, [key(value)])

  // Leaving the screen saves what is pending.
  useEffect(() => () => flush(current.current), [])

  const set = useCallback((next: T | ((now: T) => T)): void => {
    setValue(now => (typeof next === 'function' ? (next as (now: T) => T)(now) : next))
  }, [])

  return [value, set]
}

/** A text that saves itself: notes, mostly. Nothing is saved until it has loaded. */
export function useAutosave(saved: string | undefined, save: (value: string) => Promise<unknown>, ms = 700): [string, (value: string) => void] {
  return useAutosaved(saved ?? '', save, { ms, isReady: saved !== undefined })
}
