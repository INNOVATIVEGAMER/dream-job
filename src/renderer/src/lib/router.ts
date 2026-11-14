import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

const read = (): string => window.location.hash.replace(/^#/, '') || '/'

/** The current screen as path parts: `#/job/12` is `['job', '12']`. */
export function useRoute(): string[] {
  const path = useSyncExternalStore(subscribe, read)
  return path.split('/').filter(Boolean)
}

/** Goes to a screen, such as `/tracker` or `/settings/profile`. */
export function go(path: string): void {
  window.location.hash = path
}
