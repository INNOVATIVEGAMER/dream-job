import { z } from 'zod'

import { cleanLink } from '../../shared/links'
import {
  EMAIL_COUNTS,
  EMPLOYERS,
  EXPERIENCE_FITS,
  HUNT_PORTALS,
  HUNT_WINDOWS,
  OUTREACH_STATES,
  PORTAL_NAMES,
  PORTALS,
  REQUESTS_PER_COMPANY,
  SOURCES,
  STAGES,
  STATUSES,
  TRACKER_VIEWS,
  WORK_MODES,
} from '../../shared/types'
import { answerOf, isMissing, isPending } from '../../shared/form'
import type { DataTopic, FilledFact, FormField, RunState, WrittenAnswer } from '../../shared/types'
import { approveWritten, browserTools, guarded, pressRef, refuse, REFUSE, say, typeInto } from '../browser/tools'
import type { Store } from '../db/store'
import { PreferencesSchema, ProfileSchema } from '../db/settings'
import type { Flows } from '../flows'
import { cut, defineTool } from '../runs/engine'
import type { AnyTool, OpenForm, RunContext, RunEngine } from '../runs/engine'
import { CompanyEdit, CompanyQuery, httpsLink, id, JobEdit, NewJob } from '../schemas'

/** What the chat's tools reach: the tracker, the runs, the screens, and a Chrome tab of the chat's own. */
export type ChatToolDeps = {
  /** The chat as a run's tools see one: its own Chrome tab, its cards, its log. */
  ctx: RunContext
  store: Store
  engine: RunEngine
  flows: Flows
  changed: (...topics: DataTopic[]) => void
  /** Asks the user on a card in the chat; true when they confirm. */
  confirm: (card: { title: string; body: string; quote?: string | null; facts?: FilledFact[]; yes: string }) => Promise<boolean>
  /** Takes the app to a screen, such as `/job/12`. */
  navigate: (path: string) => void
}

/** A tool's answer as JSON, cut to a size Claude can work with. */
const json = (value: unknown, max = 40_000) => say(cut(JSON.stringify(value), max))

const DECLINED = 'The user said no on the confirmation card. Nothing was changed. Do not try again unless they ask.'

/** The screens the app has, as paths `open_screen` accepts. */
const SCREEN =
  /^\/(|tracker(\/(new|found|applied|outreached|referred|interview|offer|closed|discarded))?|job\/\d+|company\/\d+(\/ask)?|hunt|run|runs(\/\d+)?|never-show|email(\/\d+)?|settings(\/(preferences|profile|resume|message|answers|portals(\/[a-z]+)?|accounts|gmail))?)$/

/** A run in a few lines: where it stands and its newest steps. */
function runBrief(run: RunState | null): unknown {
  if (!run) return { run: null }
  return {
    id: run.id,
    title: run.title,
    status: run.status,
    progress: run.progress,
    counts: run.counts,
    waitingOnUser: run.card ? run.card.kind : null,
    sessions: run.lanes.map(lane => ({ title: lane.title, jobId: lane.jobId, status: lane.status, waitingOnUser: lane.card?.kind ?? null, last: lane.last, result: lane.result })),
    recent: run.events.slice(-15).map(event => `${event.kind}: ${event.text}`),
    result: run.result,
  }
}

function readTools(deps: ChatToolDeps): AnyTool[] {
  const { store, engine } = deps
  return [
    defineTool(
      'get_overview',
      'The home screen in data: jobs per status, how many companies, what needs the user now, the latest runs, the last hunt and the last email check.',
      {},
      () => guarded(async () => json(store.home())),
    ),
    defineTool(
      'search_tracker',
      'The tracker, company first: each company with its jobs in the view (id, role, status, score, portal, work mode, years asked, starred, last change). Filter by view, company sizes, portals, work modes, starred, a lowest score, and a search over company and role. Up to 80 companies.',
      {
        view: z.enum(TRACKER_VIEWS).optional().describe('Which jobs: a status view, "closed" (rejected and dead), "discarded", or "all" (everything but discarded, the default)'),
        stages: z.array(z.enum(STAGES)).optional().describe('Company sizes to keep; none means every size'),
        portals: z.array(z.enum(SOURCES)).optional().describe('Portals to keep, such as linkedin, or "manual" for jobs added by hand; none means every portal'),
        search: z.string().max(200).optional().describe('Words in the company name or role'),
        modes: z.array(z.enum(WORK_MODES)).optional(),
        employers: z.array(z.enum(EMPLOYERS)).optional().describe('"named", or "undisclosed" for a recruiting firm\'s posting for a client it doesn\'t name; none means both'),
        experience: z
          .array(z.enum(EXPERIENCE_FITS))
          .optional()
          .describe('"within": asks no more than a year past the user\'s experience; "above": asks more, so no referral asks; "not-stated"; none means all'),
        starred: z.boolean().optional().describe('true: only jobs the user starred; false: only jobs not starred; leave out for both'),
        min_score: z.number().int().min(1).max(10).optional().describe('Only jobs that scored at least this (1-10); jobs with no score are left out'),
      },
      args =>
        guarded(async () => {
          const query = CompanyQuery.parse({
            view: args.view ?? 'all',
            stages: args.stages ?? [],
            portals: args.portals ?? [],
            search: args.search ?? '',
            modes: args.modes ?? [],
            employers: args.employers ?? [],
            experience: args.experience ?? [],
            starred: args.starred ?? null,
            minScore: args.min_score ?? null,
          })
          const list = store.trackerList(query)
          const companies = list.companies.slice(0, 80).map(company => ({
            id: company.id,
            name: company.name,
            stage: company.stage,
            status: company.status,
            people: company.people,
            neverShow: company.neverShow,
            jobs: company.jobs.map(job => ({ id: job.id, role: job.role, status: job.status, score: job.score, portal: job.portal, workMode: job.workMode, minYears: job.minYears, starred: job.starred, updated: job.updated })),
          }))
          return json({ shown: companies.length, matching: list.companies.length, counts: list.counts, totalJobs: list.totalJobs, companies })
        }),
    ),
    defineTool(
      'list_companies',
      "Every company's id and name, filtered by words in the name: for finding a company the user names.",
      { search: z.string().max(200).optional() },
      ({ search }) =>
        guarded(async () => {
          const words = (search ?? '').trim().toLowerCase()
          const names = store.companies.names().filter(one => !words || one.name.toLowerCase().includes(words))
          return json({ total: names.length, companies: names.slice(0, 200) })
        }),
    ),
    defineTool(
      'get_job',
      "One job in full: its fields, notes, score reasons, its company, people there, who was asked about it, and its history.",
      { job_id: id },
      ({ job_id }) =>
        guarded(async () => {
          const detail = store.jobDetail(job_id)
          if (!detail) return refuse(`No job ${job_id}.`)
          return json({ ...detail, activity: detail.activity.slice(0, 40) })
        }),
    ),
    defineTool(
      'get_company',
      'One company in full: its details and notes, its jobs, everyone you know or asked there with what each was asked (outreach ids included), and its history.',
      { company_id: id },
      ({ company_id }) =>
        guarded(async () => {
          const detail = store.companyDetail(company_id)
          if (!detail) return refuse(`No company ${company_id}.`)
          return json({ ...detail, activity: detail.activity.slice(0, 40) })
        }),
    ),
    defineTool(
      'list_runs',
      'Past runs, newest first, 15 a page: flow, title, status, result line and usage.',
      { flow: z.string().max(40).optional().describe('hunt, apply, check, connect, referral or email'), page: z.number().int().min(0).max(1000).optional() },
      ({ flow, page }) => guarded(async () => json(store.runs.page({ flow: flow ?? '', portal: '', page: page ?? 0 }))),
    ),
    defineTool(
      'get_run',
      "One past run: its summary and its activity log.",
      { run_id: id },
      ({ run_id }) =>
        guarded(async () => {
          const summary = store.runs.get(run_id)
          if (!summary) return refuse(`No run ${run_id}.`)
          return json({ summary, events: store.runs.events(run_id).slice(-120) })
        }),
    ),
    defineTool('get_current_run', 'The run going now, or the last one: status, progress, each session, and its newest steps.', {}, () => guarded(async () => json(runBrief(engine.current())))),
    defineTool(
      'get_settings',
      "The user's settings: preferences (what the hunt looks for), profile (experience, skills, links, what is never mentioned), referral message, resume, which portals are on, and the email check.",
      {},
      () =>
        guarded(async () => {
          const all = store.settings.all()
          const portals = Object.fromEntries(Object.entries(all.portals).map(([portal, setting]) => [portal, { enabled: setting.enabled, freeBrowsing: setting.freeBrowsing }]))
          return json({ ...all, portals })
        }),
    ),
    defineTool('list_saved_answers', 'The saved answers to form questions that applications reuse, with their ids.', {}, () => guarded(async () => json(store.settings.answers()))),
    defineTool('list_never_show', 'The companies hunts skip, with why.', {}, () => guarded(async () => json(store.neverShow.list()))),
    defineTool(
      'get_email_check',
      'One email check (the last one by default): what it read, and every change it made to jobs and people, with the activity ids that undo_email_change takes.',
      { run_id: id.optional() },
      ({ run_id }) =>
        guarded(async () => {
          const runId = run_id ?? store.runs.last('email')?.id
          if (!runId) return say('No email check has run yet.')
          const detail = store.emailDetail(runId)
          return detail ? json(detail) : refuse(`Run ${runId} is not an email check.`)
        }),
    ),
  ]
}

function editTools(deps: ChatToolDeps): AnyTool[] {
  const { store, changed, confirm } = deps
  const jobName = (jobId: number): string => {
    const job = store.jobs.row(jobId)
    return job ? `${job.role} at ${job.company}` : `job ${jobId}`
  }
  const companyName = (companyId: number): string => store.companies.get(companyId)?.name ?? `company ${companyId}`

  return [
    defineTool(
      'set_job_status',
      'Move one or more jobs to a status. Discarding hides a job from the tracker; restore_job brings it back.',
      { job_ids: z.array(id).min(1).max(100), status: z.enum(STATUSES) },
      ({ job_ids, status }) =>
        guarded(async () => {
          const lines: string[] = []
          for (const jobId of new Set(job_ids)) {
            try {
              store.jobs.setStatus(jobId, status)
              lines.push(`${jobName(jobId)}: now ${status}`)
            } catch (error) {
              lines.push(`job ${jobId}: not changed, ${error instanceof Error ? error.message : String(error)}`)
            }
          }
          changed('jobs')
          return say(lines.join('\n'))
        }),
    ),
    defineTool(
      'star_jobs',
      'Star one or more jobs, or take the star off (starred: false). A star is the user\'s own mark for jobs to come back to: the tracker filters by it, and search_tracker takes starred: true to list them. It changes nothing else.',
      { job_ids: z.array(id).min(1).max(200), starred: z.boolean().describe('true stars them, false unstars them') },
      ({ job_ids, starred }) =>
        guarded(async () => {
          const wanted = [...new Set(job_ids)]
          const done = store.jobs.setStarred(wanted, starred)
          changed('jobs')
          const missing = wanted.filter(one => !done.includes(one))
          const lines = done.map(jobId => `${jobName(jobId)}: ${starred ? 'starred' : 'unstarred'}`)
          if (missing.length) lines.push(`No job ${missing.join(', ')}: nothing changed there.`)
          return say(lines.join('\n'))
        }),
    ),
    defineTool(
      'edit_job',
      "Change one value of a job, as its page does: role, company (one in the tracker or a new one), reqId, minYears, score (1-10), portal, postingLink, applyLink, pay, or found (YYYY-MM-DD). An empty text or null clears it.",
      { job_id: id, change: JobEdit },
      ({ job_id, change }) =>
        guarded(async () => {
          store.editJob(job_id, change)
          changed('jobs')
          return say(`Changed ${change.field} of ${jobName(job_id)}.`)
        }),
    ),
    defineTool(
      'set_job_notes',
      "Replace a job's notes with this text. Read the job first and keep what should stay.",
      { job_id: id, notes: z.string().max(20_000) },
      ({ job_id, notes }) =>
        guarded(async () => {
          store.jobs.setNotes(job_id, notes)
          changed('jobs')
          return say(`Saved the notes on ${jobName(job_id)}.`)
        }),
    ),
    defineTool(
      'set_work_mode',
      "Set a job's work mode.",
      { job_id: id, work_mode: z.enum(WORK_MODES) },
      ({ job_id, work_mode }) =>
        guarded(async () => {
          store.jobs.setWorkMode(job_id, work_mode)
          changed('jobs')
          return say(`${jobName(job_id)} is ${work_mode}.`)
        }),
    ),
    defineTool(
      'add_job',
      'Add a job by hand, such as one a recruiter sent. It needs the company, its stage, the role, an https link, a status and the portal (or "manual"). Answers the new job id.',
      NewJob.shape,
      input =>
        guarded(async () => {
          const job = NewJob.parse(input)
          const jobId = store.transaction(() => store.jobs.addManual({ ...job, link: cleanLink(job.link) }))
          changed('jobs')
          return say(`Added job ${jobId}: ${job.role} at ${job.company}.`)
        }),
    ),
    defineTool(
      'restore_job',
      'Bring a discarded job back to found.',
      { job_id: id },
      ({ job_id }) =>
        guarded(async () => {
          store.jobs.restore(job_id)
          changed('jobs')
          return say(`${jobName(job_id)} is back at found.`)
        }),
    ),
    defineTool(
      'edit_company',
      "Change one value of a company: name, headcount, linkedinUrl or website. An empty value clears all but the name.",
      { company_id: id, change: CompanyEdit },
      ({ company_id, change }) =>
        guarded(async () => {
          store.editCompany(company_id, change)
          changed('jobs', 'people')
          return say(`Changed ${change.field} of ${companyName(company_id)}.`)
        }),
    ),
    defineTool(
      'set_company_stage',
      "Set a company's stage.",
      { company_id: id, stage: z.enum(STAGES) },
      ({ company_id, stage }) =>
        guarded(async () => {
          store.companies.setStage(company_id, stage)
          changed('jobs')
          return say(`${companyName(company_id)} is a ${stage}.`)
        }),
    ),
    defineTool(
      'set_company_notes',
      "Replace a company's notes with this text. Read the company first and keep what should stay.",
      { company_id: id, notes: z.string().max(20_000) },
      ({ company_id, notes }) =>
        guarded(async () => {
          store.companies.setNotes(company_id, notes)
          changed('jobs')
          return say(`Saved the notes on ${companyName(company_id)}.`)
        }),
    ),
    defineTool(
      'set_outreach_state',
      'Record where a referral ask stands: sent, replied, referred or declined. Referred moves its job to referred. The outreach id comes from get_job or get_company.',
      { outreach_id: id, state: z.enum(OUTREACH_STATES) },
      ({ outreach_id, state }) =>
        guarded(async () => {
          store.setOutreachState(outreach_id, state)
          changed('jobs', 'people')
          return say(`That ask is now ${state}.`)
        }),
    ),
    defineTool(
      'save_answer',
      'Save an answer to a form question, for applications to reuse. A question already saved gets the new answer.',
      { question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(2000) },
      ({ question, answer }) =>
        guarded(async () => {
          store.settings.saveAnswer(question, answer)
          changed('answers')
          return say('Saved.')
        }),
    ),
    defineTool(
      'remove_answer',
      'Remove a saved form answer by its id.',
      { answer_id: id },
      ({ answer_id }) =>
        guarded(async () => {
          store.settings.removeAnswer(answer_id)
          changed('answers')
          return say('Removed.')
        }),
    ),
    defineTool(
      'undo_email_change',
      'Undo one change an email check made to a job or person, by its activity id from get_email_check.',
      { activity_id: id },
      ({ activity_id }) =>
        guarded(async () => {
          store.undoEmailChange(activity_id)
          changed('email', 'jobs', 'people')
          return say('Undone.')
        }),
    ),

    // These ask on a card first.
    defineTool(
      'merge_companies',
      'Move everything at one company (jobs, people, asks, history) onto another, when they are the same company under two names. The user confirms on a card first.',
      { from_company_id: id, into_company_id: id },
      ({ from_company_id, into_company_id }) =>
        guarded(async () => {
          const from = companyName(from_company_id)
          const into = companyName(into_company_id)
          const yes = await confirm({ title: `Merge ${from} into ${into}?`, body: `Everything at ${from} moves to ${into}: its jobs, people, asks and history. ${from} is then gone.`, yes: 'Merge' })
          if (!yes) return refuse(DECLINED)
          store.transaction(() => store.companies.merge(from_company_id, into_company_id))
          changed('jobs', 'people')
          return say(`Merged ${from} into ${into}.`)
        }),
    ),
    defineTool(
      'never_show',
      'Turn "never show" on or off for a company: hunts skip every job at a company with it on. Give a company_id, or a company_name for one not in the tracker yet (turning it on only). The user confirms on a card first.',
      {
        company_id: id.optional(),
        company_name: z.string().trim().min(1).max(200).optional(),
        on: z.boolean(),
        why: z.string().max(500).describe('Why, in a few words, as the user said it'),
      },
      ({ company_id, company_name, on, why }) =>
        guarded(async () => {
          const name = company_id ? companyName(company_id) : company_name
          if (!name) return refuse('Give a company_id or a company_name.')
          if (!company_id && !on) return refuse('Give the company_id to turn never show off.')
          const yes = await confirm({
            title: on ? `Never show ${name}?` : `Show ${name} again?`,
            body: on ? `Hunts will skip every job at ${name}.${why ? ` Why: ${why}` : ''}` : `Hunts will find jobs at ${name} again.`,
            yes: on ? 'Never show' : 'Show again',
          })
          if (!yes) return refuse(DECLINED)
          if (company_id) store.companies.setNeverShow(company_id, on, why)
          else store.neverShow.add(name, why)
          changed('jobs')
          return say(on ? `Hunts now skip ${name}.` : `Hunts find ${name} again.`)
        }),
    ),
    defineTool(
      'update_preferences',
      'Change what the hunt looks for. Give only the fields that change; the rest stay. Lists replace the whole list, so read get_settings first and include what should stay. The user confirms on a card first.',
      { changes: PreferencesSchema.partial() },
      ({ changes }) =>
        guarded(async () => {
          const keys = Object.keys(changes)
          if (keys.length === 0) return refuse('Nothing to change.')
          const next = { ...store.settings.preferences(), ...changes }
          PreferencesSchema.parse(next)
          const yes = await confirm({ title: 'Change your preferences?', body: keys.map(key => `${key}: ${JSON.stringify(changes[key as keyof typeof changes])}`).join('\n'), yes: 'Save' })
          if (!yes) return refuse(DECLINED)
          store.settings.setPreferences(next)
          changed('settings')
          return say(`Saved: ${keys.join(', ')}.`)
        }),
    ),
    defineTool(
      'update_profile',
      "Change the user's profile, the source every written answer is drawn from. Give only the fields that change; roles, projects and skills replace the whole list, so read get_settings first and keep every entry and id that should stay. Never add experience the user did not state. The user confirms on a card first.",
      { changes: ProfileSchema.partial() },
      ({ changes }) =>
        guarded(async () => {
          const keys = Object.keys(changes)
          if (keys.length === 0) return refuse('Nothing to change.')
          const next = { ...store.settings.profile(), ...changes }
          ProfileSchema.parse(next)
          const yes = await confirm({ title: 'Change your profile?', body: `Changes ${keys.join(', ')}.`, quote: cut(JSON.stringify(changes), 1200), yes: 'Save' })
          if (!yes) return refuse(DECLINED)
          store.settings.setProfile(next)
          changed('settings')
          return say(`Saved: ${keys.join(', ')}.`)
        }),
    ),
    defineTool(
      'update_referral_message',
      'Change the saved referral message, sent word for word, or whether it attaches the resume. Slots allowed: {name}, {role}, {company}, {job link}. The user confirms on a card first.',
      { template: z.string().max(4000).optional(), attach_resume: z.boolean().optional() },
      ({ template, attach_resume }) =>
        guarded(async () => {
          const current = store.settings.referral()
          const next = { ...current, ...(template !== undefined ? { template } : {}), ...(attach_resume !== undefined ? { attachResume: attach_resume } : {}) }
          const yes = await confirm({
            title: 'Change your referral message?',
            body: next.attachResume ? 'It attaches your resume.' : 'It goes without your resume.',
            quote: next.template,
            yes: 'Save',
          })
          if (!yes) return refuse(DECLINED)
          store.settings.setReferral(next)
          changed('settings')
          return say('Saved the referral message.')
        }),
    ),
  ]
}

function runTools(deps: ChatToolDeps): AnyTool[] {
  const { store, engine, flows, confirm, navigate } = deps
  const started = (runId: number, what: string) => {
    navigate('/run')
    return say(`Started run ${runId}: ${what}. The app now shows the Run screen; anything it needs from the user appears there. Use get_current_run to follow it.`)
  }
  const jobLine = (jobId: number): string => {
    const job = store.jobs.row(jobId)
    return job ? `${job.company}: ${job.role}` : `job ${jobId}`
  }

  return [
    defineTool(
      'start_hunt',
      "Start a hunt: search the portals for the user's target roles, score each new posting, and add the ones that fit. By default every portal turned on, over the window in their preferences. Sends nothing.",
      { portals: z.array(z.enum(PORTALS)).min(1).optional(), window: z.enum(HUNT_WINDOWS).optional() },
      ({ portals, window }) =>
        guarded(async () => {
          const on = store.settings.portals()
          const picked = portals ?? HUNT_PORTALS.filter(portal => on[portal].enabled)
          const runId = await flows.hunt({ portals: picked, window: window ?? store.settings.preferences().window })
          return started(runId, `a hunt on ${picked.map(portal => PORTAL_NAMES[portal]).join(', ')}`)
        }),
    ),
    defineTool(
      'start_apply',
      'Apply to found jobs: one session per job, 5 at a time, from the resume and saved answers. Each filled application then waits on the Run screen, where the user reviews its form and submits it. The user confirms on a card first.',
      { job_ids: z.array(id).min(1).max(50) },
      ({ job_ids }) =>
        guarded(async () => {
          const ids = [...new Set(job_ids)]
          const yes = await confirm({ title: `Apply to ${ids.length === 1 ? 'this job' : `${ids.length} jobs`}?`, body: ids.map(jobLine).join('\n'), yes: 'Apply' })
          if (!yes) return refuse(DECLINED)
          return started(await flows.apply(ids), `applying to ${ids.length} ${ids.length === 1 ? 'job' : 'jobs'}`)
        }),
    ),
    defineTool(
      'check_postings',
      "Read jobs' postings: closed found jobs are marked dead, and each keeps the company's apply link. No ids: every found and applied job. Sends nothing.",
      { job_ids: z.array(id).max(200).optional() },
      ({ job_ids }) => guarded(async () => started(await flows.checkPostings(job_ids ?? []), 'checking postings')),
    ),
    defineTool(
      'send_connection_requests',
      `Send new blank LinkedIn connection requests to people at each company (${REQUESTS_PER_COMPANY} each by default), one session per company. The user confirms on a card first.`,
      { company_ids: z.array(id).min(1).max(50), per_company: z.number().int().min(1).max(30).optional() },
      ({ company_ids, per_company }) =>
        guarded(async () => {
          const ids = [...new Set(company_ids)]
          const each = per_company ?? REQUESTS_PER_COMPANY
          const names = ids.map(companyId => store.companies.get(companyId)?.name ?? `company ${companyId}`)
          const yes = await confirm({
            title: `Send connection requests at ${ids.length === 1 ? names[0] : `${ids.length} companies`}?`,
            body: `Up to ${each} blank requests at each of: ${names.join(', ')}. LinkedIn watches bulk requests most.`,
            yes: 'Send requests',
          })
          if (!yes) return refuse(DECLINED)
          return started(await flows.connect({ companyIds: ids, perCompany: each }), 'sending connection requests')
        }),
    ),
    defineTool(
      'refresh_people',
      "Read the user's LinkedIn connections at each company: adds people, and marks requests that were accepted. Sends nothing.",
      { company_ids: z.array(id).min(1).max(50) },
      ({ company_ids }) => guarded(async () => started(await flows.refreshPeople(company_ids), 'reading your connections')),
    ),
    defineTool(
      'send_referral',
      "Send the user's saved referral message, word for word, about one job to people connected at its company who were not asked about it yet. Person ids come from get_company. The user confirms on a card first.",
      { job_id: id, person_ids: z.array(id).min(1).max(20), attach_resume: z.boolean().optional().describe('By default, as the saved message says') },
      ({ job_id, person_ids, attach_resume }) =>
        guarded(async () => {
          const referral = store.settings.referral()
          const resume = attach_resume ?? referral.attachResume
          const names = [...new Set(person_ids)].map(personId => store.people.get(personId)?.name ?? `person ${personId}`)
          const yes = await confirm({
            title: `Ask ${names.length === 1 ? names[0] : `${names.length} people`} for a referral?`,
            body: `About ${jobLine(job_id)}, to ${names.join(', ')}${resume ? ', with your resume' : ''}.`,
            quote: referral.template,
            yes: 'Send',
          })
          if (!yes) return refuse(DECLINED)
          return started(await flows.referral({ jobId: job_id, personIds: person_ids, resume }), 'sending referral messages')
        }),
    ),
    defineTool('check_accepted', 'Read the newest LinkedIn connections and mark everyone who accepted a request. Sends nothing.', {}, () => guarded(async () => started(await flows.checkAccepted(), 'checking accepted requests'))),
    defineTool(
      'check_email',
      'Read the newest emails in Gmail and move the tracker on: rejections, interviews, offers and replies. Sends nothing.',
      { count: z.number().int().optional().describe(`How many of the newest emails to read: ${EMAIL_COUNTS.join(', ')}. By default, the setting`) },
      ({ count }) => guarded(async () => started(await flows.email(count ? { count } : {}), 'checking email')),
    ),
    defineTool(
      'stop_run',
      'Stop the run going now: waiting cards are cancelled and sessions end where they are.',
      {},
      () =>
        guarded(async () => {
          if (!engine.isBusy()) return say('No run is going.')
          await engine.stop()
          return say('Stopping the run.')
        }),
    ),
    defineTool(
      'open_screen',
      'Take the app to a screen so the user sees what you mean: "/" home, "/tracker" or "/tracker/<view>", "/job/<id>", "/company/<id>", "/company/<id>/ask" (pick people to ask), "/hunt", "/run" (the run going now), "/runs/<id>", "/never-show", "/email/<run id>", "/settings/<tab>".',
      { path: z.string().max(80) },
      ({ path }) =>
        guarded(async () => {
          if (!SCREEN.test(path)) return refuse(`${path} is not a screen of the app.`)
          navigate(path)
          return say(`Showing ${path}.`)
        }),
    ),
  ]
}

const WrittenAnswerSchema = z.object({
  ref: z.number().int().positive().describe('The number of the text field from read_page'),
  label: z.string().describe('The question as the form words it'),
  text: z.string().describe('Your written answer'),
})

/** The element's own words, as the page shows them: what the user sees on the button. */
const labelScript = (ref: number): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]');
  if (!el) return null;
  return (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
})()`

/**
 * Chrome as the chat drives it: the run tools a page needs, in a tab of the
 * chat's own, with every send held for the user's approval.
 */
function chromeTools(deps: ChatToolDeps): AnyTool[] {
  const { ctx, confirm } = deps
  // A click on anything that sends is refused; send_on_page asks first.
  const tools = browserTools(ctx, REFUSE.hunt).filter(one => one.name !== 'ask_user')
  tools.push(
    defineTool(
      'send_on_page',
      "Press a button that sends something on the page (submit, apply, send, post, connect, follow, message) once the user approves. Give the button's number from read_page, one sentence on what it sends, and every free-text answer you wrote into the form so the user can check and edit it first. Nothing is pressed unless they approve.",
      {
        ref: z.number().int().positive().describe('The number of the button from read_page'),
        what: z.string().max(300).describe('What pressing it sends, in one sentence'),
        written_answers: z.array(WrittenAnswerSchema).max(10).describe('Free-text answers you wrote; empty when there are none'),
      },
      ({ ref, what, written_answers }) =>
        guarded(async () => {
          const label = await ctx.chrome.evaluate<string | null>(labelScript(ref))
          if (label === null) return refuse(`No element ${ref}. Read the page again.`)
          const page = await ctx.chrome.page()
          await ctx.chrome.bringToFront()
          let answers: WrittenAnswer[] = written_answers
          if (answers.length) {
            const approved = await approveWritten(ctx, answers, [{ label: 'Button', value: label || '(no label)' }, { label: 'Page', value: page.url }])
            if (!approved) return refuse(DECLINED)
            answers = approved.texts
            for (const answer of answers) await typeInto(ctx, answer.ref, answer.text)
          } else {
            const yes = await confirm({ title: `Press "${label || 'this button'}"?`, body: what, quote: `${page.title}\n${page.url}`, yes: 'Press it' })
            if (!yes) return refuse(DECLINED)
          }
          await ctx.chrome.allowSubmit()
          await pressRef(ctx, ref)
          await ctx.chrome.settle()
          ctx.log('good', `Pressed "${label}"`)
          const after = await ctx.chrome.page()
          return say(`Pressed "${label}". Now at ${after.url} (${after.title}). Read the page to confirm it went through.`)
        }),
    ),
    defineTool(
      'show_link',
      "Open a link in the chat's Chrome tab and bring it to the front for the user to look at, without reading it.",
      { url: httpsLink },
      ({ url }) =>
        guarded(async () => {
          await ctx.chrome.openPage(url)
          await ctx.chrome.bringToFront()
          return say(`Showing ${url} in Chrome.`)
        }),
    ),
  )
  return tools
}

/** A form field as the chat reads it: the question, the answer it goes out with, and where it stands. */
const fieldBrief = (field: FormField): Record<string, unknown> => ({
  key: field.key,
  ...(field.page > 1 ? { page: field.page } : {}),
  question: field.label,
  kind: field.kind,
  ...(field.options ? { options: field.options.slice(0, 60) } : {}),
  answer: answerOf(field),
  ...(field.isRequired ? { required: true, ...(isMissing(field) ? { empty: true } : {}) } : {}),
  ...(field.isWritten ? { writtenAnswer: true } : {}),
  ...(field.isReadOnly || field.kind === 'file' ? { cannotBeSetHere: true } : {}),
  setBy: field.by,
  ...(isPending(field) ? { notOnThePageYet: true, pageHolds: field.value } : {}),
  ...(field.isStuck ? { theFormWouldNotTakeIt: true } : {}),
})

/**
 * The application forms of the run going now: the chat reads the one on
 * screen and sets answers on it for the user, as they would on the Run
 * screen. It never sends one; and the applications already sent, with their answers.
 */
function formTools(deps: ChatToolDeps): AnyTool[] {
  const { store, engine } = deps
  const nameOf = (one: OpenForm): string => [one.title, one.subtitle].filter(Boolean).join(': ')
  const standing = (one: OpenForm): string =>
    one.form.sent ? 'sent' : one.isHeld ? 'filled, and waiting for the user to review and submit it' : one.status === 'running' || one.status === 'waiting' ? 'Claude is still filling it' : 'not sent: its session ended'
  /** The form a tool means: the job's, or the only one it could be. */
  const pick = (jobId: number | undefined, mustBeOpen: boolean): OpenForm | string => {
    const all = engine.forms()
    const open = all.filter(one => !one.form.sent && (one.status === 'running' || one.status === 'waiting'))
    const pool = mustBeOpen ? open : all
    if (jobId) return pool.find(one => one.jobId === jobId) ?? `Job ${jobId} has no ${mustBeOpen ? 'open ' : ''}application form in this run.`
    const held = pool.filter(one => one.isHeld)
    const only = held.length === 1 ? held[0] : pool.length === 1 ? pool[0] : null
    if (only) return only
    if (pool.length === 0) return mustBeOpen ? 'No application form is open. One opens when an apply run fills it.' : 'No run has an application form now.'
    return `Several application forms are open. Give job_id: ${pool.map(one => `${one.jobId} (${nameOf(one)}, ${standing(one)})`).join('; ')}`
  }

  return [
    defineTool(
      'get_application_form',
      "The application form of the run going now, as the Run screen shows it, read off the page in Chrome: each field's key, question, kind, choices, the answer it goes out with, who set it, and whether the page holds it yet. With several applications open, give the job_id; without one it is the application waiting for the user's review.",
      { job_id: id.optional() },
      ({ job_id }) =>
        guarded(async () => {
          const one = pick(job_id, false)
          if (typeof one === 'string') return refuse(one)
          return json({ jobId: one.jobId, application: nameOf(one), standing: standing(one), page: one.form.url, fields: one.form.fields.map(fieldBrief) })
        }),
    ),
    defineTool(
      'set_form_answers',
      "Set answers on an open application form, by the field keys get_application_form gives: for when the user asks you to redraft a written answer or change a fact. Each becomes the user's answer: the app types it into the page, or Claude in the run sets it, and nothing is sent until the page holds it. A choice takes one of its options word for word; a checkbox takes Yes or No. This never sends the application: the user submits it on the Run screen.",
      {
        job_id: id.optional(),
        answers: z
          .array(z.object({ key: z.string().max(200).describe('The field key from get_application_form'), value: z.string().max(20_000).describe('The new answer') }))
          .min(1)
          .max(40),
      },
      ({ job_id, answers }) =>
        guarded(async () => {
          const one = pick(job_id, true)
          if (typeof one === 'string') return refuse(one)
          const lines: string[] = []
          for (const answer of answers) {
            try {
              const field = await engine.setField(one.lane, answer.key, answer.value, 'chat')
              lines.push(`${field.label}: ${isPending(field) ? 'kept as their answer; it goes into the page before the application is sent' : 'set on the page'}`)
            } catch (error) {
              lines.push(`${answer.key}: not set, ${error instanceof Error ? error.message : String(error)}`)
            }
          }
          return say([`${nameOf(one)}:`, ...lines, 'Nothing was sent. The user reviews the form and submits it on the Run screen.'].join('\n'))
        }),
    ),
    defineTool(
      'get_applications',
      'The applications sent for one job, newest first, each with its form as it went out: every question and the answer it held, which were written answers, and which the user changed.',
      { job_id: id },
      ({ job_id }) =>
        guarded(async () => {
          const job = store.jobs.row(job_id)
          if (!job) return refuse(`No job ${job_id}.`)
          const sent = store.applications.forJob(job_id)
          if (sent.length === 0) return say(`No application is kept for ${job.role} at ${job.company}: none went out through the app since it began keeping them.`)
          return json(
            sent.map(one => ({
              sent: one.sent,
              route: one.route,
              submittedBy: one.byUser ? 'the user, in Chrome' : 'the app, after the user approved',
              runId: one.runId,
              page: one.url,
              answers: one.fields.map(field => ({ question: field.label, answer: field.value, ...(field.isWritten ? { writtenAnswer: true } : {}), ...(field.wanted !== null ? { changedBy: field.by } : {}) })),
            })),
          )
        }),
    ),
    defineTool(
      'search_past_answers',
      'How earlier applications answered a question, newest first: give words from the question, such as "notice period" or "expected salary". For reusing an answer, or checking what the user told a company.',
      { words: z.string().trim().min(2).max(100) },
      ({ words }) =>
        guarded(async () => {
          const found = store.applications.answers(words)
          if (found.length === 0) return say(`No sent application has a question with "${words}" in it.`)
          return json(
            found.map(one => {
              const job = store.jobs.row(one.jobId)
              return { company: job?.company ?? null, role: job?.role ?? null, jobId: one.jobId, sent: one.sent, question: one.question, answer: one.answer, ...(one.isWritten ? { writtenAnswer: true } : {}) }
            }),
          )
        }),
    ),
  ]
}

/** Every tool the chat gets, by area. */
export function chatTools(deps: ChatToolDeps): AnyTool[] {
  return [...readTools(deps), ...editTools(deps), ...runTools(deps), ...formTools(deps), ...chromeTools(deps)]
}
