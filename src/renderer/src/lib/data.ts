import { useCallback, useEffect, useRef, useState } from 'react'

import type { DataTopic } from '../../../shared/types'
import { api, messageOf } from './api'

export type Loaded<T> = {
  data: T | undefined
  error: string | null
  isLoading: boolean
  reload: () => void
}

/**
 * Loads data for a screen, again whenever `deps` change, and again whenever
 * the main process says one of `topics` changed, such as a run adding rows.
 */
export function useData<T>(load: () => Promise<T>, deps: readonly unknown[], topics: readonly DataTopic[]): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load
  const turn = useRef(0)

  const reload = useCallback(() => {
    const mine = ++turn.current
    setIsLoading(true)
    loadRef
      .current()
      .then(value => {
        if (mine !== turn.current) return
        setData(value)
        setError(null)
      })
      .catch(reason => {
        if (mine === turn.current) setError(messageOf(reason))
      })
      .finally(() => {
        if (mine === turn.current) setIsLoading(false)
      })
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps)

  const topicKey = topics.join(',')
  useEffect(() => {
    const wanted = new Set(topicKey.split(','))
    return api.onData(changed => {
      if (changed.some(topic => wanted.has(topic))) reload()
    })
  }, [topicKey, reload])

  return { data, error, isLoading, reload }
}
