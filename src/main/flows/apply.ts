import { z } from 'zod'

import { AT_ONCE, DISCARD_REASONS, PORTALS } from '../../shared/types'
import type { Opportunity, Portal } from '../../shared/types'
import { browserTools, guarded, refuse, REFUSE, say } from '../browser/tools'
import type { ApplyRecord } from '../browser/tools'
import type { Store } from '../db/store'
import { applyTools } from '../portals'
import { defineTool, onePlan } from '../runs/engine'
import type { AnyTool, FlowSpec, RunContext, RunPlan } from '../runs/engine'
import { answersText, preferencesText, profileText, WRITING_RULES } from './context'

const Output = z.object({
  outcome: z.enum(['applied', 'already-applied', 'not-applied', 'closed']),
  summary: z.string().describe('One line for the row: what happened'),
  discard: z
    .object({ line: z.string().describe('The posting\'s own words that rule it out, exactly'), reason: z.enum(DISCARD_REASONS) })
    .nullable()
    .describe('Only when the user chose to drop this posting for good; otherwise null'),
})

type Answer = z.infer<typeof Output>

/** The row's portal, when it is one the app has tools for. */
function portalOf(row: Opportunity): Portal | null {
  const key = row.portal.toLowerCase()
  return (PORTALS as readonly string[]).includes(key) ? (key as Portal) : null
}

function howToApply(portal: Portal | null, row: Opportunity): string[] {
  switch (portal) {
    case 'linkedin':
      return [
        `- Start with linkedin_read_job (job id ${row.jobId}): it says whether the posting is open, already applied to, and how to apply.`,
        '- Easy Apply: linkedin_easy_apply_fill with no values opens the form. Fill it page by page, then send it from the review page with linkedin_easy_apply_submit.',
        '- No Easy Apply: open_page with the company-site link read_job gives, and apply there.',
      ]
    case 'wellfound':
      return [
        `- Start with wellfound_read_job (link ${row.link}): it says whether the posting is there, already applied to, and how to apply.`,
        '- On Wellfound: wellfound_apply with no answers opens the form and reads it; call it again with every answer, including a short note to the company (a written answer), and it sends.',
        '- Applying on the company\'s site instead: open_page with that link, and apply there.',
      ]
    case 'instahyre':
      return [
        `- Start with instahyre_read_job (job id ${row.jobId}): it says whether the posting is there and already applied to.`,
        '- Then instahyre_apply: one step that sends the user\'s Instahyre profile, with nothing to write. Instahyre rarely shows pay, so there is no band to check.',
      ]
    default:
      return [`- Start with open_page on ${row.link}, and find the application form.`]
  }
}

function system(store: Store, row: Opportunity): string {
  const prefs = store.settings.preferences()
  const resume = store.settings.resume()
  const portal = portalOf(row)
  return [
    'This run applies to one posting for the user and submits the application. Applications are submitted directly; no one confirms each one.',
    '',
    'The posting:',
    `Company: ${row.company}`,
    `Role: ${row.role}`,
    `Portal: ${row.portal}${row.jobId ? `, job id ${row.jobId}` : ''}`,
    `Link: ${row.link ?? 'none recorded'}`,
    row.applyRoute ? `Apply route when found: ${row.applyRoute}` : '',
    row.pay ? `Pay when found: ${row.pay}` : '',
    row.experience ? `Experience asked: ${row.experience}` : '',
    row.notes ? `Notes: ${row.notes}` : '',
    '',
    'How:',
    ...howToApply(portal, row),
    '- On a company\'s own site: fill the form with type_text, choose_option, click and upload_resume, and send it with submit_form.',
    '- Closed, or no longer taking applications: finish with outcome "closed". Already applied: finish with "already-applied".',
    '- Facts come from the saved answers and the profile below. A question neither answers: ask_user, once, with every such question the form has.',
    '- Free-text answers in the user\'s voice are written answers. Write them from the profile; the user sees each before it is sent.',
    `- The resume: ${resume ? `upload_resume wherever a form asks for one.${portal === 'linkedin' ? ` On LinkedIn's resume page, keep a listed resume named "${resume.fileName}" when it is already selected; otherwise upload.` : ''}` : 'the user has not added one. Where a form requires it, hand that step to the user.'}`,
    '- A cover letter asked for as a file: hand_to_user.',
    '- A consent checkbox that gates the submit is part of applying: tick it. Agree to nothing else a page asks.',
    '- A pay band below the floor, or a requirement that plainly contradicts what the user wants: check_with_user before going on.',
    '- Signing in, creating an account, a password, a one-time code, a CAPTCHA, payment or bank details, a government ID, or the camera: hand_to_user, naming exactly what is left to do.',
    '- If the user declines, leave the form unsent and finish with "not-applied".',
    '',
    'How written answers read:',
    WRITING_RULES,
    '',
    'What the user wants:',
    preferencesText(prefs),
    '',
    'The user\'s profile, the only source for anything written about them:',
    profileText(store.settings.profile()),
    '',
    'Saved form answers:',
    answersText(store.settings.answers()),
  ]
    .filter(line => line !== '')
    .join('\n')
}

/** Stops for the user on something only they can decide, such as pay below their floor. */
function decisionTool(ctx: RunContext): AnyTool {
  return defineTool(
    'check_with_user',
    'Stop and ask the user to decide something only they can: a pay band below their floor, a requirement over their experience ceiling, or anything in the posting that plainly contradicts what they want. Quote the posting. Answers the option they chose.',
    {
      title: z.string().max(120).describe('The question, in a few words'),
      body: z.string().max(1000).describe('What you found and why it needs them'),
      quote: z.string().max(500).describe('The posting\'s own words, exactly, or ""'),
      options: z
        .array(z.object({ id: z.string().max(40), label: z.string().max(60), hint: z.string().max(200) }))
        .min(2)
        .max(3)
        .describe('Such as applying anyway, or not applying'),
    },
    ({ title, body, quote, options }) =>
      guarded(async () => {
        ctx.log('warn', `Asked you: ${title}`)
        const reply = await ctx.ask({ kind: 'decision', title, body, quote: quote || null, facts: [], options: options.map((option, i) => ({ ...option, isPrimary: i === 0 })) })
        if (reply.kind !== 'choose') return refuse('The user stopped the run. Finish now without doing anything more.')
        const chosen = options.find(option => option.id === reply.option)
        ctx.log('step', `You chose: ${chosen?.label ?? reply.option}`)
        return say(`The user chose: ${chosen?.label ?? reply.option}.`)
      }),
  )
}

const ROUTE_WORDS: Record<NonNullable<ApplyRecord['sent']>['route'], string> = {
  'easy-apply': 'with LinkedIn Easy Apply',
  'company-site': 'on the company\'s site',
  wellfound: 'on Wellfound',
  instahyre: 'on Instahyre',
}

/** What went in the application, for the row's notes. */
function noteOf(record: ApplyRecord, summary: string): string {
  const sent = record.sent!
  return [
    `Applied ${ROUTE_WORDS[sent.route]}${sent.byUser ? ', submitted by you' : ''}. ${summary}`,
    sent.written.length ? `Written answers, approved by you${sent.edited ? ' with your edits' : ''}:` : '',
    ...sent.written.map(answer => `- ${answer.label}: ${answer.text}`),
    sent.facts.length ? 'Facts filled:' : '',
    ...sent.facts.map(fact => `- ${fact.label}: ${fact.value}`),
  ]
    .filter(Boolean)
    .join('\n')
}

function finish(store: Store, row: Opportunity, record: ApplyRecord, answer: Answer, ctx: RunContext): string {
  const rows = store.opportunities
  if (record.posting && !record.posting.closed) rows.setPosting(row.id, 'open', null)
  ctx.changed('opportunities')

  // A submit the app saw go through settles it, whatever the answer says.
  if (record.sent) {
    rows.markApplied(row.id, noteOf(record, answer.summary), ctx.runId)
    return `Applied to ${row.company}${record.sent.byUser ? ': you pressed submit' : ''}.`
  }
  switch (answer.outcome) {
    case 'applied':
      rows.appendNote(row.id, `Run ${ctx.runId}: Claude reported applying, but the app did not see a submit go through.`)
      return 'Claude said it applied, but the app did not see a submit go through. Check Chrome, then set the status yourself.'
    case 'already-applied':
      rows.setStatus(row.id, 'applied', ctx.runId)
      rows.appendNote(row.id, `Already applied before this run. ${answer.summary}`)
      return `Already applied to ${row.company}: the row is now applied.`
    case 'closed':
      rows.setPosting(row.id, 'closed', answer.summary)
      rows.setStatus(row.id, 'dead', ctx.runId)
      return `${row.company} is no longer taking applications: the row is marked dead.`
    default:
      if (answer.discard) {
        store.discardRow(row.id, answer.discard.line, answer.discard.reason, ctx.runId)
        ctx.changed('discarded')
        return `Not applied, and moved to Discarded. ${answer.summary}`
      }
      rows.appendNote(row.id, `Not applied (run ${ctx.runId}): ${answer.summary}`)
      return `Not applied. ${answer.summary}`
  }
}

export function applySpec(store: Store, row: Opportunity): FlowSpec<Answer> {
  const record: ApplyRecord = { written: [], edited: false, facts: [], sent: null, posting: null }
  const portal = portalOf(row)
  return {
    flow: 'apply',
    title: `Apply: ${row.company}`,
    laneTitle: row.company,
    subtitle: row.role,
    portal: row.portal,
    playbooks: portal ? [portal] : [],
    opportunityId: row.id,
    system: system(store, row),
    prompt: 'Apply to this posting.',
    tools: ctx => [
      ...(portal ? applyTools(ctx, portal, record) : []),
      ...browserTools(ctx, REFUSE.apply, { submitForm: true, onSent: sent => (record.sent = sent) }),
      decisionTool(ctx),
    ],
    output: Output,
    finish: (answer, ctx) => finish(store, row, record, answer, ctx),
    maxTurns: 120,
  }
}

/** Applies to rows: one session per row, 5 at a time, each in its own tab. */
export function applyPlan(store: Store, rows: Opportunity[]): RunPlan {
  const sessions = rows.map(row => applySpec(store, row))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  return {
    flow: 'apply',
    title: `Apply to ${rows.length} rows`,
    subtitle: rows.map(row => row.company).join(', '),
    portal: null,
    sessions,
    atOnce: AT_ONCE,
    unit: 'Rows done',
    finish: outcomes => {
      const statuses = rows.map(row => store.opportunities.get(row.id)?.status)
      const applied = statuses.filter(status => status === 'applied').length
      const dead = statuses.filter(status => status === 'dead').length
      const unfinished = outcomes.filter(outcome => outcome.status !== 'done').length
      const rest = rows.length - applied - dead
      return [
        `${applied} of ${rows.length} applied.`,
        dead ? `${dead} no longer taking applications.` : '',
        rest ? `${rest} not applied${unfinished ? `, ${unfinished} of them because the session did not finish` : ''}: each session's line below says why.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    },
  }
}
