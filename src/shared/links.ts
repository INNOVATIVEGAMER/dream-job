/** Query parameters that only track where a click came from. */
const TRACKING = /^(utm_.+|gh_src|lever-source|source|src|ref|refid|trk|trackingid|ccuid|iis|iisn)$/i

/** A link without tracking parameters or a fragment: what the tracker saves and a referral message sends. */
export function cleanLink(url: string): string {
  try {
    const parsed = new URL(url.trim())
    for (const key of [...parsed.searchParams.keys()]) if (TRACKING.test(key)) parsed.searchParams.delete(key)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url.trim()
  }
}

/** Two links to the same page compare equal: host, path and query, without tracking, `www.` or a trailing slash. */
export function linkKey(url: string): string {
  try {
    const parsed = new URL(cleanLink(url))
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

/** A link on one of the portals the app drives, as opposed to a company's own apply page. */
export function isPortalLink(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return /(^|\.)(linkedin\.com|wellfound\.com|angel\.co|instahyre\.com)$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}
