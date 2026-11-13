import { z } from 'zod'

import { AT_ONCE, DISCARD_REASONS, HUNT_WINDOW_NAMES, PORTAL_NAMES, STAGES } from '../../shared/types'
import type { HuntWindow, Portal, Preferences, Profile } from '../../shared/types'
import { browserTools, guarded, refuse, REFUSE, say } from '../browser/tools'
import type { Store } from '../db/store'
import { huntTools, postingLink } from '../portals'
import { defineTool, onePlan } from '../runs/engine'
import type { AnyTool, FlowSpec, RunContext, RunPlan } from '../runs/engine'
import { fitText, preferencesText } from './context'

type Search = { role: string; mode: 'remote' | 'hybrid' | 'on-site'; place: string }

/** LinkedIn's searches: each target role, remote in the country, and hybrid and on-site in each city. */
export function plannedSearches(prefs: Preferences): Search[] {
  const searches: Search[] = []
  const places = prefs.cities.length ? prefs.cities : prefs.country ? [prefs.country] : ['']
  for (const role of prefs.targetRoles) {
    if (prefs.modes.remote) searches.push({ role, mode: 'remote', place: prefs.country })
    for (const place of places) {
      if (prefs.modes.hybrid) searches.push({ role, mode: 'hybrid', place })
      if (prefs.modes.onsite) searches.push({ role, mode: 'on-site', place })
    }
  }
  return searches
}

const listOf = (names: string[]): string =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '')

const listNames = (portals: Portal[]): string => listOf(portals.map(portal => PORTAL_NAMES[portal]))

const Output = z.object({ summary: z.string().describe('One or two sentences on what this hunt found') })

function howToSearch(portal: Portal, searches: Search[]): string[] {
  switch (portal) {
    case 'linkedin':
      return [
        'LinkedIn: run each of these searches with linkedin_search_jobs, page 0 first. Look at a later page only when the first was mostly new and relevant. Read postings with linkedin_read_job by job id.',
        ...searches.map(search => `- role "${search.role}", ${search.mode}, ${search.place || 'anywhere'}`),
      ]
    case 'wellfound':
      return [
        'Wellfound: call wellfound_search_jobs once. It reads the job search the user saved on their Wellfound account (the roles, places and pay they set there), within the window. Read postings with wellfound_read_job by link.',
      ]
    case 'instahyre':
      return [
        'Instahyre: call instahyre_list_matches once. It lists the jobs Instahyre recommends for the user\'s Instahyre profile; Instahyre shows no dates, so every match counts. Read postings with instahyre_read_job by job id.',
      ]
  }
}

function system(prefs: Preferences, profile: Profile, portal: Portal, searches: Search[]): string {
  return [
    `This session is a hunt on ${PORTAL_NAMES[portal]}: find new postings that fit the user, and record every one. Other portals may be hunted at the same time by other sessions.`,
    '',
    ...howToSearch(portal, searches),
    '',
    'Every new posting a search returns ends in exactly one call: add_posting or discard_posting.',
    '1. Screen it from its search line. Discard straight away only when that line alone rules it out (the title is plainly a role the user skips or plainly not one they want, or the place is plainly outside where they can work), quoting it.',
    '2. Read the rest with the portal\'s read_job, then add or discard it.',
    '',
    'What the user wants:',
    preferencesText(prefs),
    '',
    'Who the user is, to judge fit:',
    fitText(profile),
    '',
    'How to judge:',
    '- The kind of company is never a cut: product or services, recruiter, consultancy, employer of record, foreign or local, any size.',
    '- Title and seniority never cut a posting. Years asked for are a ceiling: within it, any level is fine. Over it, discard as over-ceiling quoting the line, unless the match is unusually strong on substance; then add it with a score of at most 6 and say so in notes.',
    '- Pay: discard as below-floor only when the whole band shown sits below the floor, quoting it. No pay shown is recorded as "not shown" and is never a reason.',
    '- A role that is mainly a kind the user skips: discard as skipped-role, quoting the line that shows it.',
    '- Place: a remote role limited to regions the user cannot work from, or a hybrid or on-site role outside their cities, is discarded as location, quoting it.' +
      (prefs.needsVisa ? ' The user needs sponsorship: a posting that says it offers none is discarded as location.' : ''),
    '- A posting the portal says is closed or gone: discard as closed.',
    '- A recruiting firm hiring for a client is added like any posting. Company is the client where named, otherwise "Undisclosed (via <firm>)"; put what the firm says about the client in notes.',
    '- Stage: as read_job gives it from headcount. Where the portal shows none, use scaleup and say it is provisional in notes.',
    '- Score 1 to 10 for fit: how closely the work matches the roles wanted and the user\'s skills and experience. Add postings scoring 5 or more. Below 5, discard as other, quoting the line that shows the mismatch.',
    '- The same role at the same company is one posting, whichever portal shows it: add_posting says when it is already tracked, perhaps from another portal, and leaves it.',
    '- A discard\'s line is the posting\'s own words, copied exactly.',
    '',
    'Finish when every search has run and every new posting is added or discarded.',
  ].join('\n')
}

/** The hunt's own tools: what to keep and what to rule out. */
type Tally = { added: number; discarded: number }

function recordTools(ctx: RunContext, portal: Portal, tallies: Tally[], onDecided: (key: string) => void): AnyTool[] {
  const { store } = ctx
  const portalEnum = z.enum([portal])
  const linkFor = (portal: Portal, jobId: string, link: string): string | null => postingLink(portal, jobId) ?? (link.startsWith('https://') ? link : null)

  return [
    defineTool(
      'add_posting',
      'Add a posting to the tracker as found, with its score and the reasons for it.',
      {
        portal: portalEnum,
        job_id: z.string().regex(/^\d+$/).describe('The posting\'s numeric id on its portal'),
        link: z.string().max(500).describe('The posting\'s link as the search or read_job gave it'),
        role: z.string().min(1).max(200).describe('The posting\'s title'),
        company: z.string().min(1).max(200),
        stage: z.enum(STAGES),
        mode: z.string().max(120).describe('Work mode and place, such as "Remote, India" or "Hybrid, Bengaluru"'),
        applicants: z.string().max(120).describe('As the portal shows it, or ""'),
        pay: z.string().max(200).describe('The band as shown, or "not shown"'),
        experience: z.string().max(200).describe('The years asked for, quoted, or "not stated"'),
        apply_route: z.enum(['easy-apply', 'wellfound', 'instahyre', 'company-site', 'unknown']),
        score: z.number().int().min(1).max(10),
        reasons: z.array(z.string().max(200)).min(1).max(4).describe('Short lines: what matched or fell short'),
        notes: z.string().max(2000).describe('Anything worth knowing before applying, or ""'),
      },
      input =>
        guarded(async () => {
          const link = linkFor(input.portal, input.job_id, input.link)
          if (!link) return refuse('Give the posting\'s full https link, as the search gave it.')
          onDecided(`${input.portal}:${input.job_id}`)
          if (store.opportunities.findExisting(input.portal, input.job_id, input.company, input.role)) return say('Already in the tracker: left as it is.')
          const never = store.neverShow.match(input.company)
          if (never) return refuse(`${input.company} is on never show again (${never.why}). Leave it.`)
          store.opportunities.addFound(
            {
              company: input.company,
              role: input.role,
              stage: input.stage,
              portal: input.portal,
              jobId: input.job_id,
              link,
              mode: input.mode,
              applicants: input.applicants,
              pay: input.pay,
              experience: input.experience,
              applyRoute: input.apply_route,
              score: input.score,
              scoreReasons: input.reasons,
              notes: input.notes,
            },
            ctx.runId,
          )
          for (const tally of tallies) tally.added++
          ctx.count('added')
          ctx.changed('opportunities')
          ctx.log('good', `Added ${input.company}, ${input.role} (score ${input.score})`)
          return say('Added.')
        }),
    ),
    defineTool(
      'discard_posting',
      'Rule a posting out, with the posting\'s own words that rule it out, copied exactly. The company stays eligible for other roles.',
      {
        portal: portalEnum,
        job_id: z.string().regex(/^\d+$/),
        link: z.string().max(500).describe('The posting\'s link as the search gave it'),
        role: z.string().min(1).max(200),
        company: z.string().min(1).max(200),
        line: z.string().min(3).max(500).describe('The posting\'s words, exactly as written'),
        reason: z.enum(DISCARD_REASONS),
      },
      input =>
        guarded(async () => {
          onDecided(`${input.portal}:${input.job_id}`)
          if (store.discarded.has(input.portal, input.job_id)) return say('Already discarded.')
          store.discarded.add(
            {
              company: input.company,
              role: input.role,
              portal: input.portal,
              jobId: input.job_id,
              link: linkFor(input.portal, input.job_id, input.link),
              line: input.line,
              reason: input.reason,
            },
            ctx.runId,
          )
          for (const tally of tallies) tally.discarded++
          ctx.count('discarded')
          ctx.changed('discarded')
          ctx.log('step', `Discarded ${input.company}, ${input.role}: ${input.reason}`)
          return say('Discarded.')
        }),
    ),
  ]
}

/** One portal's hunt, in a session of its own. `total` is the whole run's tally, shared by every portal's session. */
function huntSpec(store: Store, portal: Portal, window: HuntWindow, total: Tally): FlowSpec<z.infer<typeof Output>> {
  const prefs = store.settings.preferences()
  const profile = store.settings.profile()
  const searches = portal === 'linkedin' ? plannedSearches(prefs) : []
  const steps = portal === 'linkedin' ? searches.length : 1
  const tally: Tally = { added: 0, discarded: 0 }
  // Searches run, new postings they found, and postings added or discarded, all for the progress bar.
  const searched = new Set<string>()
  const found = new Set<string>()
  const decided = new Set<string>()

  return {
    flow: 'hunt',
    title: `Hunt on ${PORTAL_NAMES[portal]}`,
    laneTitle: PORTAL_NAMES[portal],
    subtitle: `${HUNT_WINDOW_NAMES[window]}${searches.length ? `, ${searches.length} LinkedIn ${searches.length === 1 ? 'search' : 'searches'}` : ''}`,
    portal,
    playbooks: [portal],
    system: system(prefs, profile, portal, searches),
    prompt: 'Run the hunt.',
    tools: ctx => {
      // Searches until one finds something new; from then on, the postings decided out of those found.
      const show = (): void => {
        const run = Math.min(searched.size, steps)
        if (found.size === 0) ctx.progress('Searches run', run, steps)
        else ctx.progress(run < steps ? `Postings decided, ${run} of ${steps} searches run` : 'Postings decided', decided.size, found.size)
      }
      show()
      const hunt = {
        window,
        onSearch: (search: string | null, postings: string[]) => {
          if (search) searched.add(search)
          for (const key of postings) found.add(key)
          show()
        },
      }
      const onDecided = (key: string): void => {
        if (!found.has(key) || decided.has(key)) return
        decided.add(key)
        show()
      }
      const general = browserTools(ctx, REFUSE.hunt).filter(tool => ['hand_to_user', 'read_page'].includes(tool.name))
      return [...huntTools(ctx, portal, hunt), ...recordTools(ctx, portal, [tally, total], onDecided), ...general]
    },
    output: Output,
    finish: answer => `Added ${tally.added}, discarded ${tally.discarded}. ${answer.summary}`,
    maxTurns: 300,
  }
}

/** A hunt: one session per portal, all at once, each in its own tab. */
export function huntPlan(store: Store, portals: Portal[], window: HuntWindow): RunPlan {
  const total: Tally = { added: 0, discarded: 0 }
  const sessions = portals.map(portal => huntSpec(store, portal, window, total))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  const searches = portals.includes('linkedin') ? plannedSearches(store.settings.preferences()).length : 0
  return {
    flow: 'hunt',
    title: `Hunt on ${listNames(portals)}`,
    subtitle: `${HUNT_WINDOW_NAMES[window]}, one session per portal${searches ? `, ${searches} LinkedIn ${searches === 1 ? 'search' : 'searches'}` : ''}`,
    portal: null,
    sessions,
    atOnce: AT_ONCE,
    unit: 'Portals done',
    finish: outcomes => {
      const unfinished = outcomes.filter(outcome => outcome.status !== 'done').map(outcome => outcome.title)
      return `Added ${total.added}, discarded ${total.discarded} across ${listNames(portals)}.${unfinished.length ? ` ${listOf(unfinished)} did not finish: its activity says why.` : ''}`
    },
  }
}
