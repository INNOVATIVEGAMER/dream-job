import { z } from 'zod'

import { AT_ONCE } from '../../shared/types'
import type { Company } from '../../shared/types'
import { browserTools, REFUSE } from '../browser/tools'
import type { Store } from '../db/store'
import { linkedinTools } from '../portals/linkedin'
import { linkedinNetworkTools } from '../portals/linkedin-network'
import type { MessagePlan } from '../portals/linkedin-network'
import { onePlan } from '../runs/engine'
import type { FlowSpec, RunPlan } from '../runs/engine'
import { portalIdOf } from '../portals'

const Output = z.object({ summary: z.string().describe('One or two sentences on what this run did') })
type Answer = z.infer<typeof Output>

const handOver = (tools: ReturnType<typeof browserTools>): ReturnType<typeof browserTools> => tools.filter(tool => tool.name === 'hand_to_user')

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** How many people at a company have a request out or are connected, by current position. */
const knownAt = (store: Store, companyId: number): number => {
  const counts = store.people.counts([companyId]).get(companyId)
  return counts ? counts.connected + counts.requested : 0
}

/**
 * Blank connection requests at one company the user found or applied to:
 * the wide end of the referral track. Nobody gets words from the user until
 * they accept. Each run reaches people the user doesn't know yet, so another
 * click at the same company means more people there.
 */
export function connectSpec(store: Store, company: Company, perCompany: number): FlowSpec<Answer> {
  const prefs = store.settings.preferences()
  const profile = store.settings.profile()
  const job = store.connectJob(company.id)
  const before = knownAt(store, company.id)
  const linkedinId = job?.portal === 'linkedin' ? portalIdOf('linkedin', job.portalLink) : null
  const undisclosed = /^Undisclosed \(via /i.test(company.name)

  return {
    flow: 'connect',
    title: 'Connection requests',
    laneTitle: company.name,
    subtitle: job ? job.role : `Up to ${perCompany}`,
    portal: 'linkedin',
    system: [
      'This run sends blank LinkedIn connection requests to people at a company the user is applying to or has applied to, so that once they accept, the user\'s approved referral message can go to them.',
      'A request never carries a note: linkedin_send_blank_request never adds one. Nothing in this run writes to anyone.',
      '',
      `The company: ${company.name}${company.linkedinUrl ? ` (LinkedIn page ${company.linkedinUrl})` : ''}. Up to ${perCompany} new requests.`,
      job ? `The job: ${job.status === 'found' ? 'about to apply for' : 'applied for'} "${job.role}"${linkedinId ? ` (LinkedIn job ${linkedinId})` : ''}.` : '',
      undisclosed ? 'The client is undisclosed: the recruiting firm\'s recruiter who posted it is the person to connect with.' : '',
      '',
      'Steps:',
      '1. Find its LinkedIn page. For a LinkedIn job, linkedin_read_job gives the company page and the hiring team. Otherwise linkedin_find_people looks the company up by name.',
      '2. linkedin_find_people with keywords for the user\'s field, loading more when too few come back.',
      `3. Pick up to ${perCompany} people whose work is closest to the role: engineers in the same area, their managers, and anyone on the hiring team. Skip students, interns, and anyone whose headline says they have left.`,
      '4. linkedin_send_blank_request for each. Someone already connected or already pending is recorded, not sent.',
      'If LinkedIn says the invitation limit is reached, stop sending at once and finish.',
      '',
      `The user's field: ${prefs.targetRoles.join('; ') || profile.headline}. Headline: ${profile.headline}.`,
    ]
      .filter(line => line !== '' || true)
      .join('\n'),
    prompt: 'Send the connection requests.',
    tools: ctx => [...linkedinTools(ctx, {}), ...linkedinNetworkTools(ctx, { connect: company }), ...handOver(browserTools(ctx, REFUSE.connect))],
    output: Output,
    finish: answer => {
      const sent = knownAt(store, company.id) - before
      return `${sent > 0 ? `${plural(sent, 'person', 'people')} added` : 'Nobody new'}. ${answer.summary}`
    },
    maxTurns: 150,
  }
}

/** Connection requests: one session per company, 5 at a time, each in its own tab. */
export function connectPlan(store: Store, companies: Company[], perCompany: number): RunPlan {
  const before = companies.reduce((sum, company) => sum + knownAt(store, company.id), 0)
  const sessions = companies.map(company => connectSpec(store, company, perCompany))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  return {
    flow: 'connect',
    title: 'Connection requests',
    subtitle: `${plural(companies.length, 'company', 'companies')}, up to ${perCompany} each, one session per company`,
    portal: 'linkedin',
    sessions,
    atOnce: AT_ONCE,
    unit: 'Companies done',
    finish: (_outcomes, halted) => {
      const sent = companies.reduce((sum, company) => sum + knownAt(store, company.id), 0) - before
      return `${sent > 0 ? `${plural(sent, 'person', 'people')} added` : 'Nobody new'} across ${plural(companies.length, 'company', 'companies')}.${halted ? ` ${halted}: the rest did not start.` : ''}`
    },
  }
}

/** Reads the newest connections and moves whoever accepted to connected. */
export function checkSpec(store: Store): FlowSpec<Answer> {
  const before = store.people.stateCounts()
  return {
    flow: 'connect',
    title: 'Check who accepted',
    subtitle: `${plural(before.requested, 'request')} out`,
    portal: 'linkedin',
    system: 'This run checks who accepted the user\'s connection requests. Call linkedin_list_new_connections once, then finish with what it found.',
    prompt: 'Check who accepted.',
    tools: ctx => [...linkedinNetworkTools(ctx, { check: true }), ...handOver(browserTools(ctx, REFUSE.referral))],
    output: Output,
    finish: answer => {
      const accepted = store.people.stateCounts().connected - before.connected
      return `${accepted > 0 ? `${accepted} newly connected` : 'Nobody new accepted'}. ${answer.summary}`
    },
    maxTurns: 12,
  }
}

/**
 * The user's approved referral message, word for word, to the people picked,
 * about one job. The app fills the slots and types it; Claude only goes down
 * the list. Each message that goes is an Outreach row.
 */
export function referralSpec(store: Store, plan: MessagePlan): FlowSpec<Answer> {
  const job = store.jobs.get(plan.jobId)
  if (!job) throw new Error('That job is no longer in the tracker.')
  const people = plan.personIds.map(id => store.people.get(id)).filter(person => person !== null)
  const sent = (): number => plan.personIds.filter(id => store.outreach.find(job.id, id)).length
  const before = sent()
  return {
    flow: 'referral',
    title: 'Referral messages',
    laneTitle: job.company,
    subtitle: `${plural(people.length, 'person', 'people')}, about ${job.role}`,
    portal: 'linkedin',
    jobId: job.id,
    system: [
      `This run sends the user's approved referral message${plan.resume ? ', with their resume,' : ''} about one job to people who accepted their connection requests.`,
      'Call linkedin_send_referral_message for each person below, one at a time. You write nothing: the app fills the slots and types the approved wording itself.',
      'If a send is refused, go on to the next person. If LinkedIn signs out, hand_to_user, then carry on.',
      '',
      `${job.company}, about "${job.role}":`,
      ...people.map(person => `- person ${person.id}: ${person.name}, ${person.headline}`),
    ].join('\n'),
    prompt: 'Send the referral messages.',
    tools: ctx => [...linkedinNetworkTools(ctx, { message: plan }), ...handOver(browserTools(ctx, REFUSE.referral))],
    output: Output,
    finish: answer => `${sent() - before} of ${plural(people.length, 'message')} sent. ${answer.summary}`,
    maxTurns: 20 + people.length * 8,
  }
}

/** People each referral session messages: a long list goes out in batches. */
const MESSAGE_BATCH = 10

/**
 * Referral messages about one job: one session per batch of people, one
 * batch after another, so messages never go from several tabs at once.
 */
export function referralPlan(store: Store, plan: MessagePlan): RunPlan {
  const batches: number[][] = []
  for (let i = 0; i < plan.personIds.length; i += MESSAGE_BATCH) batches.push(plan.personIds.slice(i, i + MESSAGE_BATCH))
  const sessions = batches.map(personIds => referralSpec(store, { ...plan, personIds }))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  const job = store.jobs.row(plan.jobId)
  const sent = (): number => plan.personIds.filter(id => store.outreach.find(plan.jobId, id)).length
  const before = sent()
  return {
    flow: 'referral',
    title: 'Referral messages',
    subtitle: `${plural(plan.personIds.length, 'person', 'people')}${job ? `, about ${job.role}` : ''}, ${MESSAGE_BATCH} a session`,
    portal: 'linkedin',
    jobId: plan.jobId,
    sessions,
    atOnce: 1,
    unit: 'Batches done',
    finish: (_outcomes, halted) => `${sent() - before} of ${plural(plan.personIds.length, 'message')} sent.${halted ? ` ${halted}: the rest did not start.` : ''}`,
  }
}

/**
 * One company's people brought up to date: the user's LinkedIn connections
 * there are recorded as working there and connected, and requests they
 * accepted move to connected.
 */
export function peopleSpec(store: Store, company: Company): FlowSpec<Answer> {
  const counts = (): { requested: number; connected: number } => store.people.counts([company.id]).get(company.id) ?? { connected: 0, requested: 0 }
  const before = counts()
  return {
    flow: 'connect',
    title: `People at ${company.name}`,
    laneTitle: company.name,
    subtitle: `${plural(before.connected, 'connection')}, ${plural(before.requested, 'request')} sent`,
    portal: 'linkedin',
    system: [
      `This run brings the user's people at ${company.name} up to date.`,
      'Call linkedin_company_connections once, then finish with what it found. If LinkedIn is signed out, hand_to_user with what "sign-in", then call it again.',
    ].join('\n'),
    prompt: 'Refresh the people at this company.',
    tools: ctx => [...linkedinNetworkTools(ctx, { people: company }), ...handOver(browserTools(ctx, REFUSE.connect))],
    output: Output,
    finish: answer => {
      const connected = counts().connected - before.connected
      return `${connected > 0 ? plural(connected, 'more connection') : 'No new connections'}. ${answer.summary}`
    },
    maxTurns: 12,
  }
}

/** People brought up to date at several companies: one session per company, 5 at a time, each in its own tab. */
export function peoplePlan(store: Store, companies: Company[]): RunPlan {
  if (companies.length === 1) return onePlan(peopleSpec(store, companies[0]!))
  const connectedAt = (): number => companies.reduce((sum, company) => sum + (store.people.counts([company.id]).get(company.id)?.connected ?? 0), 0)
  const before = connectedAt()
  return {
    flow: 'connect',
    title: 'Refresh connections',
    subtitle: `${plural(companies.length, 'company', 'companies')}, one session per company`,
    portal: 'linkedin',
    sessions: companies.map(company => peopleSpec(store, company)),
    atOnce: AT_ONCE,
    unit: 'Companies done',
    finish: (_outcomes, halted) => {
      const connected = connectedAt() - before
      return `${connected > 0 ? plural(connected, 'more connection') : 'No new connections'} across ${plural(companies.length, 'company', 'companies')}.${halted ? ` ${halted}: the rest did not start.` : ''}`
    },
  }
}
