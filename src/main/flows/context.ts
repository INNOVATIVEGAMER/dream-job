import { profileExperience } from '../../shared/profile'
import type { FormAnswer, Preferences, Profile, Role } from '../../shared/types'

/** The pay floor in words, with the form LinkedIn shows pay in, so a band can be compared. */
export function floorText(prefs: Preferences): string {
  if (prefs.floor === null) return 'No pay floor set.'
  // A yearly floor in rupees is set in lakh; any other is the plain amount per period.
  if (prefs.currency === 'INR' && prefs.period === 'year') {
    const millions = prefs.floor / 10
    return `Pay floor: ${prefs.floor} lakh INR a year (${millions.toFixed(millions < 10 ? 1 : 0)}M INR/yr as LinkedIn writes it, ₹${prefs.floor}L as Wellfound writes it; 1 lakh is 100K).`
  }
  return `Pay floor: ${prefs.floor.toLocaleString('en-US')} ${prefs.currency} ${prefs.period === 'hour' ? 'an' : 'a'} ${prefs.period}.`
}

/** What the user is looking for, as the hunt and apply see it. */
export function preferencesText(prefs: Preferences): string {
  const modes = (['remote', 'hybrid', 'onsite'] as const).filter(mode => prefs.modes[mode]).map(mode => (mode === 'onsite' ? 'on-site' : mode))
  return [
    `Roles wanted: ${prefs.targetRoles.join('; ') || 'none set'}`,
    `Roles skipped: ${prefs.skipRoles.join('; ') || 'none'}`,
    `Experience ceiling: ${prefs.ceilingYears === null ? 'none set' : `postings asking up to ${prefs.ceilingYears} years`}`,
    `Work modes preferred: ${modes.join(', ') || 'any'}. A preference only: no posting is ruled out for its mode.`,
    `Country: ${prefs.country || 'not set'}. Cities for on-site and hybrid: ${prefs.cities.join(', ') || 'none listed'}`,
    `Needs visa sponsorship: ${prefs.needsVisa ? 'yes' : 'no'}`,
    floorText(prefs),
  ].join('\n')
}

/** One role as the resume gives it: title, dates, what the user did there and the skills they used. */
function roleText(role: Role): string {
  return [
    `- ${role.title}, ${role.company}, ${role.start || '?'} to ${role.isCurrent ? 'present' : role.end || '?'}`,
    role.built ? role.built.split('\n').map(line => `    ${line.trim()}`).filter(line => line.trim()).join('\n') : '',
    role.skills.length ? `    Skills here: ${role.skills.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const projectText = (project: Profile['projects'][number]): string => `- ${project.name}${project.link ? ` (${project.link})` : ''}: ${project.about}`

/** The profile in full: the only source for anything written about the user. */
export function profileText(profile: Profile): string {
  const experience = profileExperience(profile)
  const roles = profile.roles.map(roleText)
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
    `Total experience: ${experience ?? 'unknown'}, from the roles: overlaps counted once, internships not counted`,
    'Roles:',
    ...(roles.length ? roles : ['- none recorded']),
    'Projects:',
    ...(profile.projects.length ? profile.projects.map(projectText) : ['- none recorded']),
    `Skills: ${profile.skills.join(', ') || 'none recorded'}`,
    `Links: ${links.join('; ') || 'none'}`,
    profile.never.trim() ? `Never mention or link: ${profile.never.split('\n').map(line => line.trim()).filter(Boolean).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The profile for judging fit in the hunt: the work the user has done, in
 * their resume's words, and every skill they list. Fit is scored against this
 * and nothing else, whatever kind of work the user does.
 */
export function fitText(profile: Profile): string {
  return [
    `Headline: ${profile.headline}`,
    `Total experience: ${profileExperience(profile) ?? 'unknown'}, internships not counted`,
    'Roles:',
    ...(profile.roles.length ? profile.roles.slice(0, 6).map(roleText) : ['- none recorded']),
    ...(profile.projects.length ? ['Projects:', ...profile.projects.map(projectText)] : []),
    `Skills: ${profile.skills.join(', ') || 'none recorded'}`,
  ].join('\n')
}

export function answersText(answers: FormAnswer[]): string {
  return answers.length ? answers.map(answer => `- ${answer.question}: ${answer.answer}`).join('\n') : '- none saved yet'
}

/** How every written answer reads. */
export const WRITING_RULES = [
  'Written answers are plain and short: a few sentences in the user\'s own voice, conversational, never a polished essay.',
  'They sell, never disqualify: say what the user has done and what they can take on. Never state a missing skill, a shortfall in years or anything they have not done. A skill or tool the profile does not list is something their experience makes quick to pick up, without claiming they have used it.',
  'Name what they did, the skill or tool they did it with, and the problem it solved. No counts or percentages unless the question asks for a number.',
  'No em dashes, arrows or middots: use commas, colons and parentheses.',
  'Draw only on the profile and the resume. Never invent experience, numbers, skills or tools, and never mention or link anything on its never list.',
  'Years with a skill or tool are answered as the rules above say. Any other direct factual field (a yes or no, a date) is answered truthfully from the saved answers, the profile and the resume, even when the truth is less than asked.',
].join('\n')
