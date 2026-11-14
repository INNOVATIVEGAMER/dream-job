import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import { TOOL_SITE_NAMES } from '../../shared/types'
import type { Portal, ToolSite, WrittenAnswer } from '../../shared/types'
import { defineTool } from '../runs/engine'
import type { AnyTool, RunContext } from '../runs/engine'
import {
  chooseScript,
  clickScript,
  fieldScript,
  fileInputScript,
  focusScript,
  pointScript,
  readScript,
  suggestionScript,
} from './page-scripts'
import type { FieldKind } from './page-scripts'

/** Words a flow never lets `click` press: sending goes through the app's own tools. */
export const REFUSE = {
  hunt: '\\b(submit|apply|send|post|connect|follow|message)\\b',
  apply: '\\b(submit|send|post|connect|follow|message)\\b',
  connect: '\\b(submit|apply|send|post|follow|message)\\b',
  referral: '\\b(submit|apply|send|post|connect|follow)\\b',
} as const

type Point = { x?: number; y?: number; error?: string; refused?: string }
type ReadResult = { url: string; title: string; scope: string; text: string; isCut: boolean; elements: string[] }

export const say = (text: string) => ({ content: [{ type: 'text' as const, text }] })
export const refuse = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })
type ToolResult = ReturnType<typeof say>

export async function guarded(work: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await work()
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error))
  }
}

/**
 * The resume as a file under the name the user gave it, for uploads and
 * attachments: the app keeps its own copy as resume.pdf, and employers should
 * see the user's file name, not that one. Null when there is no resume.
 */
export function namedResume(ctx: RunContext): string | null {
  if (!existsSync(ctx.resumePath)) return null
  const given = ctx.store.settings.resume()?.fileName ?? ''
  const name = basename(given).replace(/[^\w .()-]/g, '_').trim()
  if (!name || !/\.pdf$/i.test(name)) return ctx.resumePath
  const dir = join(dirname(ctx.resumePath), 'attach')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  copyFileSync(ctx.resumePath, path)
  return path
}

/** The portal a URL belongs to, if any. */
export function portalOf(url: string): Portal | null {
  try {
    const host = new URL(url).hostname
    if (/(^|\.)linkedin\.com$/.test(host)) return 'linkedin'
    if (/(^|\.)(wellfound\.com|angel\.co)$/.test(host)) return 'wellfound'
    if (/(^|\.)instahyre\.com$/.test(host)) return 'instahyre'
    if (/(^|\.)jsgurujobs\.com$/.test(host)) return 'jsgurujobs'
    if (/(^|\.)onlyfrontendjobs\.com$/.test(host)) return 'onlyfrontendjobs'
    if (/(^|\.)workatastartup\.com$/.test(host)) return 'workatastartup'
    if (/(^|\.)weekday\.works$/.test(host)) return 'weekday'
  } catch {
    // not a URL: no portal
  }
  return null
}

/** The site a URL belongs to among those with their own tools: a portal, or Gmail. */
function siteOf(url: string): ToolSite | null {
  try {
    if (new URL(url).hostname === 'mail.google.com') return 'gmail'
  } catch {
    return null
  }
  return portalOf(url)
}

/** Refuses general browsing on a site where the user turned it off. */
async function checkFreeBrowsing(ctx: RunContext, url?: string): Promise<string | null> {
  const where = url ?? (await ctx.chrome.page().catch(() => ({ url: '' }))).url
  const site = siteOf(where)
  if (site && !ctx.portal(site).freeBrowsing) {
    return `Free browsing is off for ${TOOL_SITE_NAMES[site]} in Settings. Use the ${TOOL_SITE_NAMES[site]} tools, or hand the step to the user with hand_to_user.`
  }
  return null
}

/** Reads the tab as text Claude can work from. */
export async function readPage(ctx: RunContext, scope: 'auto' | 'page' = 'auto', maxChars = 6000, maxElements = 150): Promise<string> {
  const page = await ctx.chrome.evaluate<ReadResult>(readScript(scope, maxChars, maxElements))
  return [
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    `Read: the ${page.scope}`,
    '',
    page.text + (page.isCut ? '\n[text cut here; read_page with scope "page" or scroll for more]' : ''),
    ...(maxElements > 0 ? ['', 'Elements:', ...page.elements] : []),
  ].join('\n')
}

/** Clicks element `ref` at its centre, with no checks: for the app's own tools, after their own checks. */
export async function pressRef(ctx: RunContext, ref: number): Promise<void> {
  const point = await ctx.chrome.evaluate<Point>(pointScript(ref))
  if (point.error) throw new Error(point.error)
  if (point.x === undefined || point.y === undefined) throw new Error('The element has no position on screen.')
  await ctx.chrome.clickAt(point.x, point.y)
}

/** Replaces what text field `ref` holds with `text`, as typing. */
export async function typeInto(ctx: RunContext, ref: number, text: string): Promise<void> {
  const focus = await ctx.chrome.evaluate<{ ok?: boolean; error?: string }>(focusScript(ref))
  if (focus.error) throw new Error(focus.error)
  await ctx.chrome.insertText(text)
}

type Fact = { label: string; value: string }

/** What a flow hears when a form is sent: where, which written answers went, and whether the user pressed it. */
export type Sent = { route: 'easy-apply' | 'company-site' | 'wellfound' | 'instahyre' | 'workatastartup' | 'weekday'; written: WrittenAnswer[]; edited: boolean; facts: Fact[]; byUser: boolean }

/** What an apply run's tools saw and sent, for the flow to save on the row. */
export type ApplyRecord = {
  written: WrittenAnswer[]
  edited: boolean
  facts: Fact[]
  sent: Sent | null
  posting: { closed: boolean; route: string; applyUrl: string | null } | null
}

/**
 * Shows written answers on the approval card, where the user may edit them,
 * and answers the approved texts, or null when the user declines. `isMidForm`
 * when the form has later pages, so the card says what approving leads to.
 */
export async function approveWritten(ctx: RunContext, answers: WrittenAnswer[], facts: Fact[], isMidForm = false): Promise<{ texts: WrittenAnswer[]; edited: boolean } | null> {
  if (answers.length === 0) return { texts: answers, edited: false }
  const page = await ctx.chrome.page().catch(() => ({ url: '', title: '' }))
  ctx.log('warn', isMidForm ? 'Holding your written answers for you' : 'Holding the submit for you')
  const reply = await ctx.ask({ kind: 'approve', url: page.url, title: page.title, answers, facts, isMidForm })
  if (reply.kind !== 'approve') {
    ctx.log('step', 'Not sent: you chose not to send it')
    return null
  }
  const texts = answers.map((answer, i) => ({ ...answer, text: reply.texts[i] ?? answer.text }))
  const edited = texts.some((answer, i) => answer.text !== answers[i]?.text)
  ctx.log('step', `You approved${edited ? ', with your edits' : ''}`)
  return { texts, edited }
}

/**
 * Sends a form the user's way: written answers wait on the approval card,
 * where the user may edit them; a form of facts alone goes straight through.
 * Approved text is typed into each field before the button is pressed, and
 * the guard is opened for this one submit only.
 */
export async function submitWithApproval(
  ctx: RunContext,
  press: () => Promise<void>,
  answers: WrittenAnswer[],
  facts: Fact[],
): Promise<{ sent: boolean; edited: boolean; texts: WrittenAnswer[] }> {
  const approved = await approveWritten(ctx, answers, facts)
  if (!approved) return { sent: false, edited: false, texts: answers }
  for (const answer of approved.texts) await typeInto(ctx, answer.ref, answer.text)
  await ctx.chrome.allowSubmit()
  await press()
  await ctx.chrome.settle()
  return { sent: true, edited: approved.edited, texts: approved.texts }
}

/**
 * Sets field `ref` from the last read to `value`, the way a person would:
 * types into a text field (and picks the matching suggestion of a type-ahead),
 * chooses a select's option, and ticks or unticks a radio or checkbox, where
 * "yes", "true" or "checked" ticks it.
 */
export async function setField(ctx: RunContext, ref: number, value: string): Promise<string> {
  const field = await ctx.chrome.evaluate<{ kind?: FieldKind; checked?: boolean; x?: number; y?: number; error?: string }>(fieldScript(ref))
  if (field.error || !field.kind) throw new Error(field.error ?? `No element ${ref}.`)
  switch (field.kind) {
    case 'text':
      await typeInto(ctx, ref, value)
      return `typed into ${ref}`
    case 'combobox': {
      await typeInto(ctx, ref, value)
      await new Promise(resolve => setTimeout(resolve, 900))
      const option = await ctx.chrome.evaluate<{ x?: number; y?: number; text?: string; none?: boolean }>(suggestionScript(value))
      if (option.none || option.x === undefined || option.y === undefined) return `typed into ${ref}; no suggestion showed`
      await ctx.chrome.clickAt(option.x, option.y)
      return `typed into ${ref} and picked "${option.text}"`
    }
    case 'select': {
      const result = await ctx.chrome.evaluate<{ chosen?: string; error?: string }>(chooseScript(ref, value))
      if (result.error) throw new Error(result.error)
      return `chose "${result.chosen}" in ${ref}`
    }
    case 'radio':
    case 'checkbox': {
      const want = field.kind === 'radio' || /^(yes|true|checked|check|on|tick)$/i.test(value.trim())
      if (field.checked === want) return `${ref} was already ${want ? 'ticked' : 'unticked'}`
      if (field.x === undefined || field.y === undefined) throw new Error(`Element ${ref} has no position on screen.`)
      await ctx.chrome.clickAt(field.x, field.y)
      return `${want ? 'ticked' : 'unticked'} ${ref}`
    }
    case 'file':
      throw new Error(`Element ${ref} is a file field: use upload_resume.`)
    default:
      throw new Error(`Element ${ref} is not a field. Read the page again and give a field's number.`)
  }
}

const WrittenAnswerSchema = z.object({
  ref: z.number().int().positive().describe('The number of the text field from read_page'),
  label: z.string().describe('The question as the form words it'),
  text: z.string().describe('Your written answer'),
})

/**
 * The tools Claude gets on any site. They drive the tab the app follows in
 * its own Chrome, with real mouse and keyboard input. `refusing` is the
 * flow's list of words click never presses.
 */
export function browserTools(
  ctx: RunContext,
  refusing: string,
  options: { submitForm?: boolean; onSent?: (sent: Sent) => void } = {},
): AnyTool[] {
  const tools: AnyTool[] = [
    defineTool(
      'open_page',
      'Open a URL in the Chrome tab and wait for it to load.',
      { url: z.string().describe('The full https URL to open') },
      ({ url }) =>
        guarded(async () => {
          const off = await checkFreeBrowsing(ctx, url)
          if (off) return refuse(off)
          await ctx.chrome.openPage(url)
          const page = await ctx.chrome.page()
          return say(`Opened ${page.url}\nTitle: ${page.title}\nCall read_page to see it.`)
        }),
    ),
    defineTool(
      'read_page',
      'Read the Chrome tab: its URL, title, the text of an open dialog or else the main region, and a numbered list of its links, buttons and fields. Use the numbers with the other tools; read again after the page changes, since the numbers change too. Scope "page" reads the whole page.',
      {
        scope: z.enum(['auto', 'page']).optional().describe('"auto" (default): an open dialog, else the main region; "page": everything'),
        max_chars: z.number().int().min(1000).max(20000).optional().describe('How much text to return, 6000 by default'),
      },
      ({ scope, max_chars }) =>
        guarded(async () => {
          const off = await checkFreeBrowsing(ctx)
          if (off) return refuse(off)
          return say(await readPage(ctx, scope ?? 'auto', max_chars ?? 6000))
        }),
    ),
    defineTool(
      'click',
      'Click element n from the last read_page, as a real mouse click. Anything that would send something (submit, send, post, and in some flows apply or connect) is refused: the app has its own tools for those.',
      { ref: z.number().int().positive().describe('The element number from read_page') },
      ({ ref }) =>
        guarded(async () => {
          const off = await checkFreeBrowsing(ctx)
          if (off) return refuse(off)
          const point = await ctx.chrome.evaluate<Point>(clickScript(ref, refusing))
          if (point.error) return refuse(point.error)
          if (point.refused) return refuse(point.refused)
          if (point.x === undefined || point.y === undefined) return refuse('The element has no position on screen.')
          const at = Date.now()
          await ctx.chrome.clickAt(point.x, point.y)
          await ctx.chrome.settle(800)
          if (await ctx.chrome.blockedSince(at)) {
            return refuse('That click tried to send a form, and the app blocked it. Forms are sent only through the submit tool.')
          }
          return say(`Clicked element ${ref}. Read the page again to see the result.`)
        }),
    ),
    defineTool(
      'type_text',
      'Type text into text field n from the last read_page, replacing what it holds, as real keyboard input.',
      {
        ref: z.number().int().positive().describe('The element number from read_page'),
        text: z.string().describe('What to type'),
      },
      ({ ref, text }) =>
        guarded(async () => {
          const off = await checkFreeBrowsing(ctx)
          if (off) return refuse(off)
          await typeInto(ctx, ref, text)
          return say(`Typed into element ${ref}.`)
        }),
    ),
    defineTool(
      'choose_option',
      'Pick an option in select element n from the last read_page, by its text. For a custom dropdown, click it instead, read the page, then click the option.',
      {
        ref: z.number().int().positive().describe('The element number from read_page'),
        option: z.string().describe('The option text, as read_page lists it'),
      },
      ({ ref, option }) =>
        guarded(async () => {
          const off = await checkFreeBrowsing(ctx)
          if (off) return refuse(off)
          const result = await ctx.chrome.evaluate<{ chosen?: string; error?: string }>(chooseScript(ref, option))
          if (result.error) return refuse(result.error)
          return say(`Chose "${result.chosen}".`)
        }),
    ),
    defineTool(
      'scroll',
      'Scroll the page down or up, to load or reach more of it.',
      { direction: z.enum(['down', 'up']) },
      ({ direction }) =>
        guarded(async () => {
          await ctx.chrome.scroll(direction === 'down' ? 700 : -700)
          return say(`Scrolled ${direction}. Read the page again.`)
        }),
    ),
    defineTool(
      'upload_resume',
      "Upload the user's resume PDF into a file field: element n from read_page, or, without a number, the first file field in the open dialog or main region.",
      { ref: z.number().int().positive().optional().describe('The file field, or the upload button next to it') },
      ({ ref }) =>
        guarded(async () => {
          const resume = namedResume(ctx)
          if (!resume) return refuse('The user has not added a resume in Settings. Hand this step to the user.')
          const found = await ctx.chrome.evaluate<{ error?: string; accept?: string }>(fileInputScript(ref ?? null))
          if (found.error) return refuse(found.error)
          await ctx.chrome.setFiles('[data-jobapp-upload="1"]', [resume])
          await ctx.chrome.settle(1200)
          ctx.log('step', 'Uploaded the resume')
          return say('Uploaded the resume. Read the page again to check it shows.')
        }),
    ),
    defineTool(
      'hand_to_user',
      'Pause and hand the Chrome window to the user for something only they may do: a sign-in, a CAPTCHA, a one-time code, an identity check, a cover letter file, or anything that needs a password, payment details, a government ID or the camera. Say in one sentence what they need to do. Returns when they say they are done; read the page again then.',
      {
        reason: z.string().describe('What the user needs to do, in one sentence'),
        what: z.enum(['captcha', 'sign-in', 'code', 'identity', 'other']).describe('The kind of step'),
      },
      ({ reason, what }) =>
        guarded(async () => {
          await ctx.chrome.bringToFront()
          ctx.log('warn', `Handed to you: ${reason}`)
          const reply = await ctx.ask({ kind: 'handover', reason, what })
          if (reply.kind !== 'resume') return refuse('The user stopped the run. Finish now without doing anything more.')
          ctx.log('step', 'You resumed')
          return say('The user says they are done. Read the page again before going on.')
        }),
    ),
    defineTool(
      'ask_user',
      'Ask the user for facts the form needs that their profile and saved answers do not hold. Ask every such question at once. Never use this for written answers: write those from the profile and submit them for approval.',
      {
        questions: z
          .array(z.object({ question: z.string().describe('The question as the form asks it'), hint: z.string().describe('What the form expects, such as a whole number') }))
          .min(1)
          .max(8),
        context: z.string().describe('Where the questions come from, such as the form page'),
      },
      ({ questions, context }) =>
        guarded(async () => {
          ctx.log('warn', `Asked you ${questions.length === 1 ? 'a question' : `${questions.length} questions`}`)
          const reply = await ctx.ask({ kind: 'question', questions, context })
          if (reply.kind !== 'answer') return refuse('The user chose not to answer and not to apply. Leave the form unsent and finish.')
          if (reply.save) {
            questions.forEach((question, i) => {
              const answer = reply.texts[i]?.trim()
              if (answer) ctx.store.settings.saveAnswer(question.question, answer)
            })
            ctx.changed('answers')
          }
          return say(questions.map((question, i) => `${question.question}: ${reply.texts[i] ?? ''}`).join('\n'))
        }),
    ),
  ]

  if (options.submitForm) {
    tools.push(
      defineTool(
        'submit_form',
        "Send a form on a company's career site. Give the submit button's number, every free-text answer you wrote (field number, the question as worded, your text), and the facts you filled. Written answers are shown to the user first and may be edited; a form of facts alone is sent straight away. If the user declines, nothing is sent and this call is refused.",
        {
          ref: z.number().int().positive().describe('The number of the submit button from read_page'),
          written_answers: z.array(WrittenAnswerSchema).max(10).describe('Free-text answers you wrote; empty when there are none'),
          facts: z.array(z.object({ label: z.string(), value: z.string() })).max(40).describe('The facts you filled, for the record'),
        },
        ({ ref, written_answers, facts }) =>
          guarded(async () => {
            const result = await submitWithApproval(ctx, () => pressRef(ctx, ref), written_answers, facts)
            if (!result.sent) return refuse('The user chose not to submit. Leave the form as it is and finish.')
            options.onSent?.({ route: 'company-site', written: result.texts, edited: result.edited, facts, byUser: false })
            ctx.log('good', 'Submitted the form')
            const page = await ctx.chrome.page()
            return say(`Submitted. Now at ${page.url} (${page.title}). Read the page to confirm it went through.`)
          }),
      ),
    )
  }

  return tools
}
