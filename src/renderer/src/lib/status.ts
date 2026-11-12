import { useSyncExternalStore } from 'react'

import type { AppStatus } from '../../../shared/types'
import { api } from './api'

let current: AppStatus | null = null
const listeners = new Set<() => void>()

function publish(status: AppStatus): void {
  current = status
  for (const listener of listeners) listener()
}

api.onStatus(publish)
void api.status().then(publish)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Claude, Chrome and the run, as the main process last reported them; null until the first report. */
export function useAppStatus(): AppStatus | null {
  return useSyncExternalStore(subscribe, () => current)
}
