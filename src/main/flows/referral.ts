import { z } from 'zod'

import { browserTools, REFUSE } from '../browser/tools'
import type { Store } from '../db/store'
import { linkedinTools } from '../portals/linkedin'
import { linkedinNetworkTools } from '../portals/linkedin-network'
import type { FlowSpec } from '../runs/engine'

const Output = z.object({ summary: z.string().describe('One or two sentences on what this run did') })
type Answer = z.infer<typeof Output>

const handOver = (tools: ReturnType<typeof browserTools>): ReturnType<typeof browserTools> => tools.filter(tool => tool.name === 'hand_to_user')

/**
 * Blank connection requests at companies the user applied to: the wide end
 * of the referral track. Nobody gets words from the user until they accept.
 */
export function connectSpec(store: Store, companies: string[], perCompany: number): FlowSpec<Answer> {
  const prefs = store.settings.preferences()
  const profile = store.settings.profile()
  const rows = companies.map(company => ({ company, row: store.appliedRow(company) })).filter(entry => entry.row)
  const before = store.contacts.counts()

  return {
    flow: 'connect',
    title: 'Connection requests',
    subtitle: `${rows.length} ${rows.length === 1 ? 'company' : 'companies'}, up to ${perCompany} each`,
    portal: 'linkedin',
    system: [
      'This run sends blank LinkedIn connection requests to people at companies the user has applied to, so that once they accept, the user\'s approved referral message can go to them.',
      'A request never carries a note: linkedin_send_blank_request never adds one. Nothing in this run writes to anyone.',
      '',
      `Companies, each with up to ${perCompany} new requests:`,
      ...rows.map(({ company, row }) =>
        `- ${company}: applied for "${row!.role}"${row!.portal.toLowerCase() === 'linkedin' && row!.jobId ? ` (LinkedIn job ${row!.jobId})` : ''}${/^Undisclosed \(via /i.test(company) ? '. The client is undisclosed: the recruiting firm\'s recruiter who posted it is the person to connect with.' : ''}`,
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
      const after = store.contacts.counts()
      const sent = after.pending - before.pending
      return `${sent > 0 ? `${sent} ${sent === 1 ? 'request' : 'requests'} out` : 'No new requests'}. ${answer.summary}`
    },
    maxTurns: 150,
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
    .map(company => ({ company, row: store.appliedRow(company), people: store.contacts.atCompany(company, 'accepted') }))
    .filter(batch => batch.row && batch.people.length)
  const ids = batches.flatMap(batch => batch.people.map(person => person.id))
  const resume = store.settings.referral().attachResume

  return {
    flow: 'referral',
    title: 'Referral messages',
    subtitle: `${ids.length} ${ids.length === 1 ? 'person' : 'people'} at ${batches.length} ${batches.length === 1 ? 'company' : 'companies'}`,
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
      const sent = ids.filter(id => store.contacts.get(id)?.state === 'messaged').length
      return `${sent} of ${ids.length} ${ids.length === 1 ? 'message' : 'messages'} sent. ${answer.summary}`
    },
    maxTurns: 80,
  }
}

/** Who a referral run would reach at these companies, for the checks before it starts. */
export function referralReach(store: Store, companies: string[]): number {
  return companies.filter(company => store.appliedRow(company)).reduce((sum, company) => sum + store.contacts.atCompany(company, 'accepted').length, 0)
}
