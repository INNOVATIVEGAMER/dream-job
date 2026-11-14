import { z } from 'zod'

import { AT_ONCE } from '../../shared/types'
import type { Company } from '../../shared/types'
import { browserTools, REFUSE } from '../browser/tools'
import type { Store } from '../db/store'
import { linkedinTools } from '../portals/linkedin'
import { linkedinNetworkTools } from '../portals/linkedin-network'
import { onePlan } from '../runs/engine'
import type { FlowSpec, RunPlan } from '../runs/engine'

const Output = z.object({ summary: z.string().describe('One or two sentences on what this run did') })
type Answer = z.infer<typeof Output>

const handOver = (tools: ReturnType<typeof browserTools>): ReturnType<typeof browserTools> => tools.filter(tool => tool.name === 'hand_to_user')

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Each company once, whatever its spelling: rows at one company share a session, so nobody is asked twice. */
function eachCompany(store: Store, companies: string[]): string[] {
  const seen = new Set<string>()
  return companies.filter(company => {
    const row = store.connectRow(company)
    const key = row ? `row:${row.id}` : company.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Blank connection requests at companies the user found or applied to: the
 * wide end of the referral track. Nobody gets words from the user until they
 * accept. Each run reaches people not yet in contacts, so another click at
 * the same company means more people there.
 */
export function connectSpec(store: Store, companies: string[], perCompany: number): FlowSpec<Answer> {
  const prefs = store.settings.preferences()
  const profile = store.settings.profile()
  const rows = companies.map(company => ({ company, row: store.connectRow(company) })).filter(entry => entry.row)
  const pendingAt = (): number => rows.reduce((sum, { company }) => sum + store.contacts.atCompany(company, 'pending').length, 0)
  const before = pendingAt()
  const only = rows.length === 1 ? rows[0]! : null

  return {
    flow: 'connect',
    title: 'Connection requests',
    laneTitle: only?.company,
    subtitle: only ? only.row!.role : `${plural(rows.length, 'company', 'companies')}, up to ${perCompany} each`,
    portal: 'linkedin',
    system: [
      'This run sends blank LinkedIn connection requests to people at companies the user is applying to or has applied to, so that once they accept, the user\'s approved referral message can go to them.',
      'A request never carries a note: linkedin_send_blank_request never adds one. Nothing in this run writes to anyone.',
      '',
      `Companies, each with up to ${perCompany} new requests:`,
      ...rows.map(({ company, row }) =>
        `- ${company}: ${row!.status === 'found' ? 'about to apply for' : 'applied for'} "${row!.role}"${row!.portal.toLowerCase() === 'linkedin' && row!.jobId ? ` (LinkedIn job ${row!.jobId})` : ''}${/^Undisclosed \(via /i.test(company) ? '. The client is undisclosed: the recruiting firm\'s recruiter who posted it is the person to connect with.' : ''}`,
      ),
      '',
      'For each company:',
      '1. Find its LinkedIn page. For a LinkedIn job, linkedin_read_job gives the company page and the hiring team. Otherwise linkedin_find_people looks the company up by name.',
      '2. linkedin_find_people with keywords for the user\'s field, loading more when too few come back.',
      `3. Pick up to ${perCompany} people whose work is closest to the role: engineers in the same area, their managers, and anyone on the hiring team. Skip students, interns, and anyone whose headline says they have left.`,
      '4. linkedin_send_blank_request for each. Someone already connected or already pending is recorded, not sent.',
      'If LinkedIn says the invitation limit is reached, stop sending at once and finish.',
      '',
      `The user's field: ${prefs.targetRoles.join('; ') || profile.headline}. Headline: ${profile.headline}.`,
    ].join('\n'),
    prompt: 'Send the connection requests.',
    tools: ctx => [
      ...linkedinTools(ctx, {}),
      ...linkedinNetworkTools(ctx, { connect: true }),
      ...handOver(browserTools(ctx, REFUSE.connect)),
    ],
    output: Output,
    finish: answer => {
      const sent = pendingAt() - before
      return `${sent > 0 ? `${plural(sent, 'request')} out` : 'No new requests'}. ${answer.summary}`
    },
    maxTurns: 150,
  }
}

/** Connection requests: one session per company, 5 at a time, each in its own tab. */
export function connectPlan(store: Store, companies: string[], perCompany: number): RunPlan {
  const each = eachCompany(store, companies)
  const before = store.contacts.counts().pending
  const sessions = each.map(company => connectSpec(store, [company], perCompany))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  return {
    flow: 'connect',
    title: 'Connection requests',
    subtitle: `${plural(each.length, 'company', 'companies')}, up to ${perCompany} each, one session per company`,
    portal: 'linkedin',
    sessions,
    atOnce: AT_ONCE,
    unit: 'Companies done',
    finish: (_outcomes, halted) => {
      const sent = store.contacts.counts().pending - before
      return `${sent > 0 ? `${plural(sent, 'request')} out` : 'No new requests'} across ${plural(each.length, 'company', 'companies')}.${halted ? ` ${halted}: the rest did not start.` : ''}`
    },
  }
}

/** Reads the newest connections and moves whoever accepted from pending to accepted. */
export function checkSpec(store: Store): FlowSpec<Answer> {
  const before = store.contacts.counts()
  return {
    flow: 'referral',
    title: 'Check who accepted',
    subtitle: `${before.pending} pending`,
    portal: 'linkedin',
    system: 'This run checks who accepted the user\'s connection requests. Call linkedin_list_new_connections once, then finish with what it found.',
    prompt: 'Check who accepted.',
    tools: ctx => [...linkedinNetworkTools(ctx, { check: true }), ...handOver(browserTools(ctx, REFUSE.referral))],
    output: Output,
    finish: answer => {
      const accepted = store.contacts.counts().accepted - before.accepted
      return `${accepted > 0 ? `${accepted} newly accepted` : 'Nobody new accepted'}. ${answer.summary}`
    },
    maxTurns: 12,
  }
}

/**
 * The user's approved referral message, word for word, to the accepted
 * contacts at the companies picked. The app fills the slots and types it;
 * Claude only goes down the list.
 */
export function referralSpec(store: Store, companies: string[]): FlowSpec<Answer> {
  const batches = companies
    .map(company => ({ company, row: store.appliedRow(company), people: store.contacts.toMessage(company) }))
    .filter(batch => batch.row && batch.people.length)
  const ids = batches.flatMap(batch => batch.people.map(person => person.id))
  const resume = store.settings.referral().attachResume

  const only = batches.length === 1 ? batches[0]! : null
  return {
    flow: 'referral',
    title: 'Referral messages',
    laneTitle: only?.company,
    subtitle: only ? `${plural(ids.length, 'person', 'people')}, for ${only.row!.role}` : `${plural(ids.length, 'person', 'people')} at ${plural(batches.length, 'company', 'companies')}`,
    portal: 'linkedin',
    system: [
      `This run sends the user's approved referral message${resume ? ', with their resume,' : ''} to people who accepted their connection requests.`,
      'Call linkedin_send_referral_message for each contact below, one at a time. You write nothing: the app fills the four slots and types the approved wording itself.',
      'If a send is refused, go on to the next person. If LinkedIn signs out, hand_to_user, then carry on.',
      '',
      ...batches.flatMap(batch => [
        `${batch.company} (points at "${batch.row!.role}"):`,
        ...batch.people.map(person => `- contact ${person.id}: ${person.name}, ${person.role}`),
      ]),
    ].join('\n'),
    prompt: 'Send the referral messages.',
    tools: ctx => [...linkedinNetworkTools(ctx, { message: true }), ...handOver(browserTools(ctx, REFUSE.referral))],
    output: Output,
    finish: answer => {
      const sent = ids.filter(id => store.contacts.get(id)?.messagedAt).length
      return `${sent} of ${ids.length} ${ids.length === 1 ? 'message' : 'messages'} sent. ${answer.summary}`
    },
    maxTurns: 80,
  }
}

/** Referral messages: one session per company, 5 at a time, each in its own tab. */
export function referralPlan(store: Store, companies: string[]): RunPlan {
  const each = eachCompany(store, companies).filter(company => store.appliedRow(company) && store.contacts.toMessage(company).length)
  const people = each.flatMap(company => store.contacts.toMessage(company).map(person => person.id))
  const sessions = each.map(company => referralSpec(store, [company]))
  if (sessions.length === 1) return onePlan(sessions[0]!)
  return {
    flow: 'referral',
    title: 'Referral messages',
    subtitle: `${plural(people.length, 'person', 'people')} at ${plural(each.length, 'company', 'companies')}, one session per company`,
    portal: 'linkedin',
    sessions,
    atOnce: AT_ONCE,
    unit: 'Companies done',
    finish: () => {
      const sent = people.filter(id => store.contacts.get(id)?.messagedAt).length
      return `${sent} of ${plural(people.length, 'message')} sent across ${plural(each.length, 'company', 'companies')}.`
    },
  }
}

/** Who a referral run would reach at these companies, for the checks before it starts. */
export function referralReach(store: Store, companies: string[]): number {
  return companies.filter(company => store.appliedRow(company)).reduce((sum, company) => sum + store.contacts.toMessage(company).length, 0)
}

/**
 * One company's people brought up to date: the user's LinkedIn connections
 * there are added as connected, and requests they accepted move to connected.
 */
export function peopleSpec(store: Store, company: Company): FlowSpec<Answer> {
  const counts = (): { pending: number; accepted: number } => {
    const people = store.contacts.atCompanyId(company.id)
    return { pending: people.filter(person => person.state === 'pending').length, accepted: people.filter(person => person.state === 'accepted').length }
  }
  const before = counts()
  return {
    flow: 'connect',
    title: `People at ${company.name}`,
    subtitle: `${plural(before.accepted, 'connection')}, ${plural(before.pending, 'request')} sent`,
    portal: 'linkedin',
    system: [
      `This run brings the user's people at ${company.name} up to date.`,
      'Call linkedin_company_connections once, then finish with what it found. If LinkedIn is signed out, hand_to_user with what "sign-in", then call it again.',
    ].join('\n'),
    prompt: 'Refresh the people at this company.',
    tools: ctx => [...linkedinNetworkTools(ctx, { people: company }), ...handOver(browserTools(ctx, REFUSE.connect))],
    output: Output,
    finish: answer => {
      const after = counts()
      const connected = after.accepted - before.accepted
      return `${connected > 0 ? `${plural(connected, 'more connection')}` : 'No new connections'}. ${answer.summary}`
    },
    maxTurns: 12,
  }
}

/** People brought up to date at several companies: one session per company, 5 at a time, each in its own tab. */
export function peoplePlan(store: Store, companies: Company[]): RunPlan {
  if (companies.length === 1) return onePlan(peopleSpec(store, companies[0]!))
  const connectedAt = (): number => companies.reduce((sum, company) => sum + store.contacts.atCompanyId(company.id).filter(person => person.state === 'accepted').length, 0)
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
