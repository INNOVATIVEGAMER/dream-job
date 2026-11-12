import { yearsOfExperience } from '../../shared/profile'
import type { FormAnswer, Preferences, Profile } from '../../shared/types'

/** The pay floor in words, with the form LinkedIn shows pay in, so a band can be compared. */
export function floorText(prefs: Preferences): string {
  if (prefs.floor === null) return 'No pay floor set.'
  if (prefs.currency === 'INR') {
    const millions = prefs.floor / 10
    return `Pay floor: ${prefs.floor} lakh INR a year (${millions.toFixed(millions < 10 ? 1 : 0)}M INR/yr as LinkedIn writes it, ₹${prefs.floor}L as Wellfound writes it; 1 lakh is 100K).`
  }
  return `Pay floor: ${prefs.floor.toLocaleString('en-US')} ${prefs.currency} a ${prefs.period}.`
}

/** What the user is looking for, as the hunt and apply see it. */
export function preferencesText(prefs: Preferences): string {
  const modes = (['remote', 'hybrid', 'onsite'] as const).filter(mode => prefs.modes[mode]).map(mode => (mode === 'onsite' ? 'on-site' : mode))
  return [
    `Roles wanted: ${prefs.targetRoles.join('; ') || 'none set'}`,
    `Roles skipped: ${prefs.skipRoles.join('; ') || 'none'}`,
    `Experience ceiling: ${prefs.ceilingYears === null ? 'none set' : `postings asking up to ${prefs.ceilingYears} years`}`,
    `Work modes: ${modes.join(', ') || 'none set'}`,
    `Country: ${prefs.country || 'not set'}. Cities for on-site and hybrid: ${prefs.cities.join(', ') || 'none listed'}`,
    `Needs visa sponsorship: ${prefs.needsVisa ? 'yes' : 'no'}`,
    floorText(prefs),
  ].join('\n')
}

/** The profile in full: the only source for anything written about the user. */
export function profileText(profile: Profile): string {
  const years = yearsOfExperience(profile)
  const roles = profile.roles.map(role =>
    [
      `- ${role.title}, ${role.company}, ${role.start || '?'} to ${role.isCurrent ? 'present' : role.end || '?'}`,
      role.built ? role.built.split('\n').map(line => `    ${line.trim()}`).filter(line => line.trim()).join('\n') : '',
      role.skills.length ? `    Skills here: ${role.skills.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
  const links = [
    profile.links.linkedin && `LinkedIn: ${profile.links.linkedin}`,
    profile.links.github && `GitHub: ${profile.links.github}`,
    profile.links.site && `Website: ${profile.links.site}`,
    ...profile.links.other.map(link => `${link.name}: ${link.url}`),
  ].filter(Boolean)
  return [
    `Name: ${profile.name}`,
    `Headline: ${profile.headline}`,
    `Lives in: ${profile.location || 'not set'}`,
    `Total experience: ${years === null ? 'unknown' : `${years} years, from the roles`}`,
    'Roles:',
    ...(roles.length ? roles : ['- none recorded']),
    'Projects:',
    ...(profile.projects.length ? profile.projects.map(project => `- ${project.name}${project.link ? ` (${project.link})` : ''}: ${project.about}`) : ['- none recorded']),
    `Skills: ${profile.skills.join(', ') || 'none recorded'}`,
    `Links: ${links.join('; ') || 'none'}`,
    profile.never.trim() ? `Never mention or link: ${profile.never.split('\n').map(line => line.trim()).filter(Boolean).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** A shorter profile, for judging fit in the hunt. */
export function fitText(profile: Profile): string {
  const years = yearsOfExperience(profile)
  return [
    `Headline: ${profile.headline}`,
    `Total experience: ${years === null ? 'unknown' : `${years} years`}`,
    `Recent roles: ${profile.roles.slice(0, 4).map(role => `${role.title} at ${role.company}`).join('; ') || 'none recorded'}`,
    `Skills: ${profile.skills.slice(0, 40).join(', ') || 'none recorded'}`,
  ].join('\n')
}

export function answersText(answers: FormAnswer[]): string {
  return answers.length ? answers.map(answer => `- ${answer.question}: ${answer.answer}`).join('\n') : '- none saved yet'
}

/** How every written answer reads. */
export const WRITING_RULES = [
  'Written answers are plain and short: a few sentences in the user\'s own voice, conversational, never a polished essay.',
  'They sell, never disqualify: say what the user has done and what they can take on. Never state a missing technology, a shortfall in years or anything they have not done. A technology the profile does not list is something their experience makes quick to pick up, without claiming they have used it.',
  'Name the technology and the problem it solved. No counts or percentages unless the question asks for a number.',
  'No em dashes, arrows or middots: use commas, colons and parentheses.',
  'Draw only on the profile. Never invent experience, numbers or technologies, and never mention or link anything on its never list.',
  'A direct factual field (years with a technology, a yes or no) is answered truthfully from the saved answers and the profile, even when the truth is less than asked.',
].join('\n')
