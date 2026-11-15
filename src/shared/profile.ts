import type { Profile, Role } from './types'

/** An internship: it shows on the profile, but postings mean years of work, so it doesn't count toward them. */
export const isInternship = (role: Pick<Role, 'title'>): boolean => /\binterns?(hip)?\b/i.test(role.title)

/**
 * Months of experience from the roles, internships left out. Roles that
 * overlap count once: two jobs held at the same time are one stretch of time.
 * A role's start and end months both count; a current role runs to this month.
 */
export function experienceMonths(profile: Pick<Profile, 'roles'>, at = new Date()): number | null {
  const spans = profile.roles
    .filter(role => !isInternship(role) && /^\d{4}-\d{2}$/.test(role.start))
    .map(role => {
      const [sy, sm] = role.start.split('-').map(Number) as [number, number]
      const endText = role.isCurrent || !role.end ? null : role.end
      const [ey, em] = endText ? (endText.split('-').map(Number) as [number, number]) : [at.getFullYear(), at.getMonth() + 1]
      return [sy * 12 + sm - 1, ey * 12 + em] as const
    })
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  if (spans.length === 0) return null
  let months = 0
  let [curStart, curEnd] = spans[0]!
  for (const [start, end] of spans.slice(1)) {
    if (start <= curEnd) curEnd = Math.max(curEnd, end)
    else {
      months += curEnd - curStart
      ;[curStart, curEnd] = [start, end]
    }
  }
  return months + curEnd - curStart
}

/** Years of experience to one decimal, for sums: 47 months is 3.9. */
export function yearsOfExperience(profile: Pick<Profile, 'roles'>, at = new Date()): number | null {
  const months = experienceMonths(profile, at)
  return months === null ? null : Math.round((months / 12) * 10) / 10
}

/** Experience in words, the way people say it: "3 years 11 months". */
export function experienceText(months: number): string {
  const years = Math.floor(months / 12)
  const rest = months % 12
  const part = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (years === 0) return part(rest, 'month')
  return rest === 0 ? part(years, 'year') : `${part(years, 'year')} ${part(rest, 'month')}`
}

/** The experience line for a profile, or null when no role has dates. */
export function profileExperience(profile: Pick<Profile, 'roles'>): string | null {
  const months = experienceMonths(profile)
  return months === null ? null : experienceText(months)
}

/**
 * How far past the user's experience a job may ask and still get a referral
 * ask: a year more is fine, beyond that the people asked lose faith in the
 * user, so the app never asks.
 */
export const ASK_STRETCH_YEARS = 1

/**
 * Why the user can't ask anyone for a referral to a job, or null when they
 * can. A job that states no years, or a profile with no dated roles, never
 * stops an ask: there is nothing to compare.
 */
export function askBlock(minYears: number | null, months: number | null): string | null {
  if (minYears === null || months === null) return null
  if (minYears * 12 <= months + ASK_STRETCH_YEARS * 12) return null
  return `Asks ${minYears}+ years, you have ${experienceText(months)}`
}
