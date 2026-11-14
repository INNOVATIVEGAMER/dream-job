/**
 * The referral message, filled the same way for the preview on screen and
 * the message a run types: the main process and the screens both use this.
 */

export type TemplateValues = { name: string; role: string; company: string; jobId: string; jobLink: string }

const SLOTS = /\{name\}|\{role\}|\{company\}|\{job id\}|\{job link\}/g

/**
 * Fills the slots. A line holding {job id} drops out when the job has no id;
 * any other slot left empty is refused, so a message never goes out with a gap.
 */
export function fillTemplate(template: string, values: TemplateValues): string {
  const filled: Record<string, string> = {
    '{name}': values.name.trim(),
    '{role}': values.role.trim(),
    '{company}': values.company.trim(),
    '{job id}': values.jobId.trim(),
    '{job link}': values.jobLink.trim(),
  }
  const lines = template.split('\n').filter(line => !(line.includes('{job id}') && !filled['{job id}']))
  const kept = lines.join('\n')
  for (const [slot, value] of Object.entries(filled)) {
    if (kept.includes(slot) && !value) throw new Error(`The message needs ${slot}, and there is none for this person.`)
  }
  return kept.replace(SLOTS, slot => filled[slot] ?? slot)
}

/** The first name a message opens with: the first real word of the name, not an initial or a title. */
export function firstName(full: string): string {
  const words = full.replace(/\(.*?\)|,.*$/g, ' ').split(/\s+/).filter(Boolean)
  const isInitial = (one: string): boolean => /^\p{L}\.?$/u.test(one)
  const isTitle = (one: string): boolean => /^(dr|mr|mrs|ms|prof|er|ca|adv)\.?$/i.test(one)
  const word = words.find(one => /^\p{L}/u.test(one) && !isInitial(one) && !isTitle(one)) ?? words[0] ?? ''
  return word.charAt(0).toUpperCase() + word.slice(1)
}
