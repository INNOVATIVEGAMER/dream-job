import type { Profile } from './types'

/** Years of experience from the roles, overlaps counted once. */
export function yearsOfExperience(profile: Pick<Profile, 'roles'>, at = new Date()): number | null {
  const spans = profile.roles
    .filter(role => /^\d{4}-\d{2}$/.test(role.start))
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
  months += curEnd - curStart
  return Math.round((months / 12) * 10) / 10
}
