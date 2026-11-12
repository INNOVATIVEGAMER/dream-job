import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { SignInSite, SiteState } from '../../shared/types'

/**
 * The cookie only a signed-in session carries, per site. A site with none
 * listed yet stays as it was: the cookie is named from the live site, never
 * guessed.
 */
const SESSION_COOKIES: Record<SignInSite, { domain: string; name: string } | null> = {
  google: { domain: 'google.com', name: 'SID' },
  linkedin: { domain: 'linkedin.com', name: 'li_at' },
  wellfound: null,
  instahyre: null,
}

/** Microseconds from 1601-01-01, as Chrome stores expiry. */
const chromeNow = (): bigint => BigInt(Date.now()) * 1000n + 11_644_473_600_000_000n

/**
 * Tells which sites the app's Chrome profile is signed in to, from the names
 * and expiry of its cookies. Cookie values are encrypted and never read.
 * Chrome holds its cookie file open, so this reads a copy.
 */
export function readSignIns(profileDir: string): Partial<Record<SignInSite, SiteState['state']>> {
  const file = [join(profileDir, 'Default', 'Network', 'Cookies'), join(profileDir, 'Default', 'Cookies')].find(path => existsSync(path))
  if (!file) return {}
  const dir = mkdtempSync(join(tmpdir(), 'job-app-cookies-'))
  try {
    const copy = join(dir, 'Cookies')
    copyFileSync(file, copy)
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      const find = db.prepare("SELECT expires_utc FROM cookies WHERE (host_key = ? OR host_key LIKE '%.' || ?) AND name = ?")
      const found: Partial<Record<SignInSite, SiteState['state']>> = {}
      for (const [site, cookie] of Object.entries(SESSION_COOKIES) as [SignInSite, (typeof SESSION_COOKIES)[SignInSite]][]) {
        if (!cookie) continue
        const rows = find.all(cookie.domain, cookie.domain, cookie.name) as { expires_utc: number | bigint }[]
        const live = rows.some(row => {
          const expires = BigInt(row.expires_utc)
          return expires === 0n || expires > chromeNow()
        })
        found[site] = live ? 'signed-in' : 'signed-out'
      }
      return found
    } finally {
      db.close()
    }
  } catch {
    return {}
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
