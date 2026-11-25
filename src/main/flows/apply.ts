import { z } from 'zod'

import { AT_ONCE, DISCARD_REASONS, PORTALS } from '../../shared/types'
import { cleanLink, isPortalLink } from '../../shared/links'
import { experienceMonths } from '../../shared/profile'
import type { Job, Portal } from '../../shared/types'
import { browserTools, guarded, refuse, REFUSE, say } from '../browser/tools'
import type { ApplyRecord } from '../browser/tools'
import type { Store } from '../db/store'
import { applyTools, portalIdOf } from '../portals'
import { defineTool, onePlan } from '../runs/engine'
import type { AnyTool, FlowSpec, RunContext, RunPlan } from '../runs/engine'
import { answersText, preferencesText, profileText, WRITING_RULES } from './context'

const Output = z.object({
  outcome: z.enum(['applied', 'already-applied', 'not-applied', 'closed']),
  summary: z.string().describe('One line for the job: what happened'),
  discard: z
    .object({ line: z.string().describe('The posting\'s own words that rule it out, exactly'), reason: z.enum(DISCARD_REASONS) })
    .nullable()
    .describe('Only when the user chose to drop this posting for good; otherwise null'),
})

type Answer = z.infer<typeof Output>

/** The job's portal, when it is one the app has tools for. */
function portalOf(row: Job): Portal | null {
  const key = row.portal.toLowerCase()
  return (PORTALS as readonly string[]).includes(key) ? (key as Portal) : null
}

function howToApply(portal: Portal | null, row: Job): string[] {
  const jobId = portal ? portalIdOf(portal, row.portalLink) : null
  // The hunt saved the company's own apply page: the application goes there.
  if (row.link && !isPortalLink(row.link)) {
    return [
      `- Start with open_page on ${row.link}: the company's own apply page, where the application goes, and the final word on the job. Closed, expired or gone there: finish with "closed".`,
      portal === 'linkedin' && jobId ? `- Only if that page is gone and you need to know whether LinkedIn still lists it: linkedin_read_job (job id ${jobId}).` : '',
    ].filter(Boolean)
  }
  switch (portal) {
    case 'linkedin':
      return [
        `- Start with linkedin_read_job (job id ${jobId}): it says whether the posting is open, already applied to, and how to apply.`,
        '- Easy Apply: linkedin_easy_apply_fill with no values opens the form. Fill it page by page, then send it from the review page with linkedin_easy_apply_submit.',
        '- No Easy Apply: open_page with the company-site link read_job gives, and apply there.',
      ]
    case 'wellfound':
      return [
        `- Start with wellfound_read_job (link ${row.portalLink ?? row.link}): it says whether the posting is there, already applied to, and how to apply.`,
        '- On Wellfound: wellfound_apply with no answers opens the form and reads it; call it again with every answer, including a short note to the company (a written answer), and it sends.',
        '- Applying on the company\'s site instead: open_page with that link, and apply there.',
      ]
    case 'workatastartup':
      return [
        `- Start with workatastartup_read_job (job id ${jobId}): it says whether the posting is there, already applied to, and what the application asks.`,
        `- Then workatastartup_open_apply opens the form: a message to the founders and the company's own questions. Fill it with type_text and choose_option, and send it with submit_form: every written answer waits for the user first.`,
      ]
    case 'weekday':
      return [
        `- Start with weekday_read_job (link ${row.portalLink ?? row.link}): it says whether it still takes applications, whether it was applied to, and where it applies.`,
        '- On Weekday: weekday_apply hands the Apply press to the user, then checks it went through.',
        "- On the company's site: open_page with the link read_job gives, and apply there.",
      ]
    case 'jsgurujobs':
    case 'onlyfrontendjobs':
      return [
        `- Start with ${portal}_read_job (${portal === 'jsgurujobs' ? `job id ${jobId}` : `link ${row.portalLink ?? row.link}`}): it gives the company's own posting, where the application goes.`,
        '- Then open_page that link and apply there.',
      ]
    case 'instahyre':
      return [
        `- Start with instahyre_read_job (job id ${jobId}): it says whether the posting is there and already applied to.`,
        '- Then instahyre_apply: one step that sends the user\'s Instahyre profile, with nothing to write. Instahyre rarely shows pay, so there is no band to check.',
      ]
    default:
      return [`- Start with open_page on ${row.link}, and find the application form.`]
  }
}

function system(store: Store, row: Job, resumeText: string | null): string {
  const prefs = store.settings.preferences()
  // Years with any one skill: the user's whole experience, rounded up to a whole year.
  const months = experienceMonths(store.settings.profile())
  const skillYears = months === null ? null : Math.ceil(months / 12)
  const resume = store.settings.resume()
  const portal = portalOf(row)
  const jobId = portal ? portalIdOf(portal, row.portalLink) : null
  return [
    'This run applies to one posting for the user. You fill the application; the user reviews the whole filled form in the app and submits it there. The tools that send hold it for them, so call them as soon as the form is filled.',
    '',
    'The posting:',
    `Company: ${row.company}`,
    `Role: ${row.role}`,
    `Portal: ${row.portal}${jobId ? `, job id ${jobId}` : ''}`,
    `Where the application goes: ${row.link ?? 'none recorded'}`,
    row.portalLink && row.portalLink !== row.link ? `Found on ${row.portal}: ${row.portalLink}` : '',
    row.applyRoute ? `Apply route when found: ${row.applyRoute}` : '',
    row.pay ? `Pay when found: ${row.pay}` : '',
    row.minYears !== null ? `Experience asked: at least ${row.minYears} years` : '',
    row.notes ? `Notes: ${row.notes}` : '',
    '',
    'How:',
    ...howToApply(portal, row),
    '- On a company\'s own site: fill the form with type_text, choose_option, click and upload_resume, and send it with submit_form.',
    '- Closed, or no longer taking applications: finish with outcome "closed". Already applied: finish with "already-applied".',
    '- Facts come from the saved answers, the profile and the resume below. Answer from what they say or plainly follow from, without asking:',
    skillYears === null
      ? '  years with a skill or tool: the roles have no dates to count from, so ask;'
      : `  years with any skill, tool or technology, whichever it is: ${skillYears}, the user\'s total experience rounded up to a whole year, as a whole number. This holds over a saved answer that gives other years for one skill;`,
    '  education (degree, field, institution, years, grade) and anything else the resume states, such as contact details and links;',
    '  a yes or no the resume settles, such as whether they hold a degree it does not list;',
    '  a choice whose options word a saved answer differently: the option that means the same;',
    '  dates that follow from the roles, such as when a role that has ended ended.',
    '- Ask only what none of them states or settles, such as pay, notice period, or a personal detail the resume leaves out: ask_user, once, with every such question the form has.',
    '- Free-text answers in the user\'s voice are written answers. Write them from the profile and the resume; the user reads each on the filled form before it is sent.',
    '- The user sees the form as you fill it and may change any answer in the app. A tool result may end with a note from the app on answers they changed: theirs stand. Leave the ones it says are on the page, set the ones it says are not (back a page if need be), and never change one back.',
    `- The resume: ${resume ? `upload_resume wherever a form asks for one.${portal === 'linkedin' ? ` On LinkedIn's resume page, keep a listed resume named "${resume.fileName}" when it is already selected; otherwise upload.` : ''}` : 'the user has not added one. Where a form requires it, hand that step to the user.'}`,
    '- The button that sends the application, whatever it is called (Submit, Apply, Send, Finish, Complete), is pressed only by submit_form or the portal\'s own submit tool, never with click: those hold the form for the user first.',
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
    'The user\'s profile, with the resume below the only source for anything written about them:',
    profileText(store.settings.profile()),
    '',
    resume
      ? resumeText
        ? `The user's resume, "${resume.fileName}", as read from the PDF (a word may break across two lines). It holds what the profile may not, such as education:\n${resumeText}`
        : 'The user\'s resume has no text that could be read: go by the profile.'
      : '',
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
  workatastartup: 'on Work at a Startup',
  weekday: 'on Weekday',
}

/**
 * The line for the job's notes. The answers themselves are kept with the
 * application, as its form; only when no form could be read off the page do
 * the notes carry what Claude said it filled.
 */
function noteOf(record: ApplyRecord, summary: string): string {
  const sent = record.sent!
  const hasForm = !!sent.form?.fields.length
  return [
    `Applied ${ROUTE_WORDS[sent.route]}${sent.byUser ? ', submitted by you' : sent.edited ? ', with your changes' : ''}. ${summary}`,
    !hasForm && sent.written.length ? 'Written answers:' : '',
    ...(hasForm ? [] : sent.written.map(answer => `- ${answer.label}: ${answer.text}`)),
    !hasForm && sent.facts.length ? 'Facts filled:' : '',
    ...(hasForm ? [] : sent.facts.map(fact => `- ${fact.label}: ${fact.value}`)),
  ]
    .filter(Boolean)
    .join('\n')
}

/** Marks the job applied and keeps the application: its form as it went out. */
function keep(store: Store, row: Job, record: ApplyRecord, summary: string, runId: number, lane: string): void {
  const sent = record.sent!
  store.transaction(() => {
    store.jobs.markApplied(row.id, noteOf(record, summary), runId)
    store.applications.add({ jobId: row.id, runId, lane, route: sent.route, byUser: sent.byUser, form: sent.form })
  })
}

function finish(store: Store, row: Job, record: ApplyRecord, answer: Answer, ctx: RunContext): string {
  const rows = store.jobs
  if (record.posting && !record.posting.closed) rows.setPosting(row.id, 'open', null)
  // A job found before apply links were saved: keep where its application goes once read_job gives it.
  const posting = record.posting
  if (posting && (!row.link || isPortalLink(row.link))) {
    if (posting.route === 'company-site' && posting.applyUrl && !isPortalLink(posting.applyUrl)) rows.setLinks(row.id, { link: cleanLink(posting.applyUrl), applyRoute: posting.route })
    else if (posting.route !== 'company-site' && !row.link && row.portalLink) rows.setLinks(row.id, { link: row.portalLink, applyRoute: posting.route })
  }
  ctx.changed('jobs')

  // A submit the app saw go through settles it, whatever the answer says.
  if (record.sent) {
    keep(store, row, record, answer.summary, ctx.runId, ctx.lane)
    return `Applied to ${row.company}${record.sent.byUser ? ': you pressed submit' : ''}.`
  }
  switch (answer.outcome) {
    case 'applied':
      rows.appendNote(row.id, `Run ${ctx.runId}: Claude reported applying, but the app did not see a submit go through.`)
      return 'Claude said it applied, but the app did not see a submit go through. Check Chrome, then set the status yourself.'
    case 'already-applied':
      rows.setStatus(row.id, 'applied', { runId: ctx.runId })
      rows.appendNote(row.id, `Already applied before this run. ${answer.summary}`)
      return `Already applied to ${row.company}: the job is now applied.`
    case 'closed':
      rows.setPosting(row.id, 'closed', answer.summary)
      rows.setStatus(row.id, 'dead', { runId: ctx.runId })
      return `${row.company} is no longer taking applications: the job is marked dead.`
    default:
      if (answer.discard) {
        rows.discard(row.id, answer.discard.line, answer.discard.reason, ctx.runId)
        ctx.changed('jobs')
        return `Not applied, and discarded. ${answer.summary}`
      }
      rows.appendNote(row.id, `Not applied (run ${ctx.runId}): ${answer.summary}`)
      return `Not applied. ${answer.summary}`
  }
}

export function applySpec(store: Store, row: Job, resumeText: string | null): FlowSpec<Answer> {
  const record: ApplyRecord = { written: [], facts: [], sent: null, posting: null }
  const portal = portalOf(row)
  return {
    flow: 'apply',
    title: `Apply: ${row.company}`,
    laneTitle: row.company,
    subtitle: row.role,
    portal: row.portal,
    playbooks: portal ? [portal] : [],
    jobId: row.id,
    system: system(store, row, resumeText),
    prompt: 'Apply to this posting.',
    tools: ctx => [
      ...(portal ? applyTools(ctx, portal, record) : []),
      ...browserTools(ctx, REFUSE.apply, { submitForm: true, onSent: sent => (record.sent = sent) }),
      decisionTool(ctx),
    ],
    output: Output,
    finish: (answer, ctx) => finish(store, row, record, answer, ctx),
    // Worked out once the session has stopped: an application the app saw go out stands, whatever the button said.
    leave: (runId, lane) => {
      if (record.sent) {
        keep(store, row, record, 'It went out just before you discarded it.', runId, lane)
        return 'Already sent when you discarded it, so the job stays applied.'
      }
      store.jobs.discard(row.id, 'You discarded it while it was being applied to', 'other', runId)
      return 'Discarded by you, not applied.'
    },
    followsForm: true,
    maxTurns: 120,
  }
}

/** Applies to rows: one session per row, 5 at a time, each in its own tab. */
export function applyPlan(store: Store, rows: Job[], resumeText: string | null): RunPlan {
  const sessions = rows.map(row => applySpec(store, row, resumeText))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  return {
    flow: 'apply',
    title: `Apply to ${rows.length} jobs`,
    subtitle: rows.map(row => row.company).join(', '),
    portal: null,
    sessions,
    atOnce: AT_ONCE,
    unit: 'Jobs done',
    finish: outcomes => {
      const statuses = rows.map(row => store.jobs.row(row.id)?.status)
      const applied = statuses.filter(status => status === 'applied').length
      const dead = statuses.filter(status => status === 'dead').length
      const discarded = statuses.filter(status => status === 'discarded').length
      // Sessions are in the rows' order: one that did not finish counts only if its job is still waiting.
      const unfinished = outcomes.filter((outcome, i) => outcome.status !== 'done' && !['applied', 'dead', 'discarded'].includes(statuses[i] ?? '')).length
      const rest = rows.length - applied - dead - discarded
      return [
        `${applied} of ${rows.length} applied.`,
        dead ? `${dead} no longer taking applications.` : '',
        discarded ? `${discarded} discarded.` : '',
        rest ? `${rest} not applied${unfinished ? `, ${unfinished} of them because the session did not finish` : ''}: each session's line below says why.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    },
  }
}
