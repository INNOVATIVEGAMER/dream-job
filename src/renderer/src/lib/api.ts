export const api = window.jobApp

/** An error's own words, without Electron's "Error invoking remote method" wrapper. */
export function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
