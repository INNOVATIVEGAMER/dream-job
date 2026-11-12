import { randomUUID } from 'node:crypto'

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { CanUseTool, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { ResumeImport } from '../../shared/types'
import { claudeEnv, findClaude } from '../claude'
import { yearsOfExperience } from '../../shared/profile'
import { schemaOf } from '../runs/engine'

const ImportOutput = z.object({
  name: z.string(),
  headline: z.string().describe('One line: the role they do and what they are known for, from the resume'),
  location: z.string().describe('City, country, if the resume says; else empty'),
  roles: z
    .array(
      z.object({
        title: z.string(),
        company: z.string(),
        start: z.string().describe('YYYY-MM; YYYY-01 when only the year is given; empty if unknown'),
        end: z.string().describe('YYYY-MM, or empty when it is their current role'),
        isCurrent: z.boolean(),
        built: z.string().describe('What they built there and with what, one point per line, in their own words lightly tidied'),
        skills: z.array(z.string()).describe('Technologies and skills this role names'),
      }),
    )
    .max(30),
  projects: z.array(z.object({ name: z.string(), link: z.string(), about: z.string() })).max(30),
  skills: z.array(z.string()).max(100),
  links: z.object({
    linkedin: z.string(),
    github: z.string(),
    site: z.string().describe('Portfolio or personal website'),
    other: z.array(z.object({ name: z.string(), url: z.string() })).max(10),
  }),
  targetRoles: z.array(z.string()).max(5).describe('2 to 4 job titles that match their recent titles and level'),
  answers: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .max(12)
    .describe('Starter form answers the resume states: Email, Phone, Current location, and Years with each of their 3 main skills'),
})

const PROMPT = (path: string): string =>
  [
    `Read the resume PDF at ${path} with the Read tool, then answer with what it says.`,
    'Copy facts exactly from the resume. Never add a role, skill, number or link it does not contain; leave a field empty when it does not say.',
    'For each role, put what they built there as one point per line, keeping their own words, lightly tidied.',
    'Years with a skill: count the years of the roles that name it. Only include a starter answer you can take from the resume.',
  ].join(' ')

/** Reads the user's resume with their own Claude Code and answers what it found, for them to review. */
export async function importResume(resumePath: string, cwd: string): Promise<ResumeImport> {
  const path = await findClaude()
  if (!path) throw new Error('Claude Code was not found. Finish step 1 first.')

  const end = new AbortController()
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content: PROMPT(resumePath) }, parent_tool_use_id: null }
    await new Promise<void>(resolve => end.signal.addEventListener('abort', () => resolve(), { once: true }))
  }

  // Claude may read this one file and nothing else.
  const canUseTool: CanUseTool = async (toolName, input) => {
    if (toolName === 'StructuredOutput') return { behavior: 'allow', updatedInput: input }
    if (toolName === 'Read' && (input as { file_path?: string }).file_path === resumePath) {
      return { behavior: 'allow', updatedInput: input }
    }
    return { behavior: 'deny', message: 'Only the resume may be read.' }
  }

  const session = query({
    prompt: prompt(),
    options: {
      pathToClaudeCodeExecutable: path,
      cwd,
      env: claudeEnv(),
      settingSources: [],
      tools: ['Read'],
      permissionMode: 'default',
      canUseTool,
      outputFormat: { type: 'json_schema', schema: schemaOf(ImportOutput) },
      persistSession: false,
      maxTurns: 6,
    },
  })

  try {
    for await (const message of session) {
      if (message.type !== 'result') continue
      if (message.subtype !== 'success') throw new Error(`Claude could not read the resume (${message.subtype}).`)
      const parsed = ImportOutput.safeParse(message.structured_output)
      if (!parsed.success) throw new Error('Claude answered in a shape the app does not accept. Try again.')
      const found = parsed.data
      const month = (value: string): string => (/^\d{4}-\d{2}$/.test(value) ? value : /^\d{4}$/.test(value) ? `${value}-01` : '')
      const profile = {
        name: found.name.trim(),
        headline: found.headline.trim(),
        location: found.location.trim(),
        roles: found.roles.map(role => ({
          id: randomUUID(),
          title: role.title.trim(),
          company: role.company.trim(),
          start: month(role.start),
          end: role.isCurrent ? null : month(role.end) || null,
          isCurrent: role.isCurrent,
          built: role.built.trim(),
          skills: [...new Set(role.skills.map(skill => skill.trim()).filter(Boolean))],
        })),
        projects: found.projects.map(project => ({ id: randomUUID(), ...project })),
        skills: [...new Set(found.skills.map(skill => skill.trim()).filter(Boolean))],
        links: found.links,
        never: '',
      }
      return {
        profile,
        targetRoles: found.targetRoles.map(role => role.trim()).filter(Boolean),
        answers: found.answers.filter(answer => answer.question.trim() && answer.answer.trim()),
        years: yearsOfExperience(profile),
      }
    }
    throw new Error('Claude finished without reading the resume.')
  } finally {
    end.abort()
    session.close()
  }
}
