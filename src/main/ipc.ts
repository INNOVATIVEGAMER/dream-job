import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename } from 'node:path'

import { dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'

import type { AppliedCompany, Channel, OpportunityDetail, RunDetail } from '../shared/api'
import { CONTACT_STATES, HUNT_WINDOWS, PORTALS, SIGN_IN_SITES, SIGN_IN_URLS, STAGES } from '../shared/types'
import type { AppStatus, DataTopic, ResumeInfo } from '../shared/types'
import type { ChromeController } from './browser/chrome'
import { findChrome } from './browser/chrome'
import { readSignIns } from './browser/signins'
import { now } from './db/database'
import type { Store } from './db/store'
import type { Flows } from './flows'
import { importResume } from './flows/resume'
import type { RunEngine } from './runs/engine'

export type IpcDeps = {
  store: Store
  chrome: ChromeController
  engine: RunEngine
  flows: Flows
  window: () => BrowserWindow | null
  status: () => AppStatus
  checkClaude: () => Promise<void>
  openChrome: (mode: 'signin' | 'controlled', url?: string) => Promise<void>
  sendData: (topics: DataTopic[]) => void
  resumePath: string
  chromeProfileDir: string
  dataDir: string
}

const id = z.number().int().positive()
const page = z.number().int().min(0).max(100_000)
const short = (max = 200) => z.string().max(max)

const TrackerQuery = z.object({ status: short(), stage: short(), portal: short(), search: short(), page })
const DiscardedQuery = z.object({ reason: short(), search: short(), page })
const ContactQuery = z.object({ state: short(), company: short(), search: short(), page })
const RunQuery = z.object({ flow: short(), portal: short(), page })
const NewRow = z.object({
  company: z.string().trim().min(1, 'Enter the company.').max(200),
  role: z.string().trim().min(1, 'Enter the role.').max(200),
  stage: z.enum(STAGES),
  portal: short(),
  link: short(1000),
  mode: short(),
  notes: short(10_000),
  status: z.enum(['found', 'applied', 'screen']),
})
const CardAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approve'), texts: z.array(z.string().max(20_000)).max(20) }),
  z.object({ kind: z.literal('cancel') }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('choose'), option: short() }),
  z.object({ kind: z.literal('answer'), texts: z.array(z.string().max(2000)).max(20), save: z.boolean() }),
])
const HuntOptions = z.object({ portals: z.array(z.enum(PORTALS)).min(1, 'Pick at least one portal.'), window: z.enum(HUNT_WINDOWS) })
const ConnectOptions = z.object({ companies: z.array(short()).min(1, 'Pick at least one company.').max(30), perCompany: z.number().int().min(1).max(30) })
const ReferralOptions = z.object({ companies: z.array(short()).min(1, 'Pick at least one company.').max(30) })

/** Counts the pages of a PDF from its page objects: close enough to tell 1 page from 2. */
function pdfPages(path: string): number | null {
  const count = (readFileSync(path).toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length
  return count > 0 ? count : null
}

/** Registers every request the screens can make. Inputs are checked here, since the screens are a separate world. */
export function registerIpc(deps: IpcDeps): void {
  const { store } = deps
  const handlers: Record<Channel, (...args: unknown[]) => unknown> = {
    status: () => deps.status(),
    checkClaude: () => deps.checkClaude(),

    'chrome:open': mode => deps.openChrome(z.enum(['signin', 'controlled']).parse(mode)),
    'chrome:close': () => deps.chrome.close(),
    'chrome:front': () => deps.chrome.bringToFront(),
    'chrome:openUrl': async url => {
      const target = z.url({ protocol: /^https?$/ }).parse(url)
      if (deps.chrome.current().mode === 'closed') await deps.openChrome('controlled', target)
      else if (deps.chrome.current().mode === 'controlled') await deps.chrome.navigate(target)
      else await shell.openExternal(target)
    },
    'chrome:signIn': async site => {
      const url = SIGN_IN_URLS[z.enum(SIGN_IN_SITES).parse(site)]
      const mode = deps.chrome.current().mode
      if (mode === 'signin') return deps.chrome.openInSignin(url)
      if (mode === 'controlled') {
        if (deps.engine.isBusy()) throw new Error('A run is using Chrome. Sign in when it finishes, or stop it first.')
        await deps.chrome.close()
      }
      await deps.openChrome('signin', url)
    },
    'chrome:info': () => ({ chromePath: findChrome(), profileDir: deps.chromeProfileDir }),

    home: () => store.home(),

    'tracker:page': query => store.opportunities.page(TrackerQuery.parse(query)),
    'tracker:get': (rowId): OpportunityDetail | null => {
      const opportunity = store.opportunities.get(id.parse(rowId))
      if (!opportunity) return null
      const contacts = CONTACT_STATES.flatMap(state => store.contacts.atCompany(opportunity.company, state))
      return { opportunity, events: store.opportunities.events(opportunity.id), contacts }
    },
    'tracker:setStatus': (rowId, status) => {
      store.opportunities.setStatus(id.parse(rowId), short().parse(status))
      deps.sendData(['opportunities'])
    },
    'tracker:setNotes': (rowId, notes) => {
      store.opportunities.setNotes(id.parse(rowId), short(20_000).parse(notes))
      deps.sendData(['opportunities'])
    },
    'tracker:add': input => {
      const row = NewRow.parse(input)
      const existing = store.opportunities.findExisting(row.portal, '', row.company, row.role)
      if (existing) throw new Error(`${existing.company}, ${existing.role} is already in the tracker. One route per role.`)
      const rowId = store.transaction(() => {
        const added = store.opportunities.addManual(row)
        if (row.status !== 'found') store.opportunities.setStatus(added, row.status)
        return added
      })
      deps.sendData(['opportunities'])
      return rowId
    },

    'discarded:page': query => store.discarded.page(DiscardedQuery.parse(query)),
    'discarded:restore': postingId => {
      const rowId = store.restoreDiscarded(id.parse(postingId))
      deps.sendData(['discarded', 'opportunities'])
      return rowId
    },
    'discarded:neverShow': () => store.neverShow.list(),
    'discarded:addNeverShow': (company, why) => {
      store.neverShow.add(short().parse(company), short(500).parse(why))
      deps.sendData(['discarded'])
    },
    'discarded:removeNeverShow': rowId => {
      store.neverShow.remove(id.parse(rowId))
      deps.sendData(['discarded'])
    },

    'contacts:page': query => store.contacts.page(ContactQuery.parse(query)),
    'contacts:ready': () => store.readyCompanies(),
    'contacts:applied': (): AppliedCompany[] => store.appliedCompanies(),
    'contacts:get': contactId => store.contacts.get(id.parse(contactId)),
    'contacts:markThanked': contactId => {
      store.contacts.markThanked(id.parse(contactId))
      deps.sendData(['contacts'])
    },

    'runs:page': query => store.runs.page(RunQuery.parse(query)),
    'runs:get': (runId): RunDetail | null => {
      const summary = store.runs.get(id.parse(runId))
      return summary ? { summary, events: store.runs.events(summary.id) } : null
    },
    'runs:answer': (cardId, answer) => deps.engine.answer(short().parse(cardId), CardAnswerSchema.parse(answer)),
    'runs:stop': () => deps.engine.stop(),

    'flows:hunt': options => deps.flows.hunt(HuntOptions.parse(options)),
    'flows:apply': rowId => deps.flows.apply(id.parse(rowId)),
    'flows:connect': options => deps.flows.connect(ConnectOptions.parse(options)),
    'flows:referral': options => deps.flows.referral(ReferralOptions.parse(options)),
    'flows:checkAccepted': () => deps.flows.checkAccepted(),
    'flows:email': options => deps.flows.email(z.object({ count: z.number().int().optional() }).parse(options ?? {})),

    'email:detail': runId => store.emailDetail(id.parse(runId)),
    'email:undo': changeId => {
      store.undoEmailChange(id.parse(changeId))
      deps.sendData(['email', 'opportunities', 'contacts'])
    },
    'email:waiting': () => store.email.waiting(),
    'email:add': waitingId => {
      const rowId = store.addEmailJob(id.parse(waitingId))
      deps.sendData(['email', 'opportunities'])
      return rowId
    },
    'email:ignore': waitingId => {
      store.email.setWaiting(id.parse(waitingId), 'ignored')
      deps.sendData(['email'])
    },

    'settings:get': () => store.settings.all(),
    'settings:setPreferences': value => {
      store.settings.setPreferences(value)
      deps.sendData(['settings'])
    },
    'settings:setProfile': value => {
      store.settings.setProfile(value)
      deps.sendData(['settings'])
    },
    'settings:setReferral': value => {
      store.settings.setReferral(value)
      deps.sendData(['settings'])
    },
    'settings:setEmail': value => {
      store.settings.setEmail(value)
      deps.sendData(['settings'])
    },
    'settings:setPortals': value => {
      store.settings.setPortals(value)
      deps.sendData(['settings'])
    },
    'settings:finishSetup': () => {
      store.settings.setSetUp(true)
      deps.sendData(['settings'])
    },
    'settings:answers': () => store.settings.answers(),
    'settings:saveAnswer': (question, answer) => {
      store.settings.saveAnswer(short(300).parse(question), short(2000).parse(answer))
      deps.sendData(['answers'])
    },
    'settings:removeAnswer': answerId => {
      store.settings.removeAnswer(id.parse(answerId))
      deps.sendData(['answers'])
    },
    'settings:sites': () => {
      for (const [site, state] of Object.entries(readSignIns(deps.chromeProfileDir))) store.settings.setSite(site, state)
      return store.settings.sites()
    },
    'settings:chooseResume': async (): Promise<ResumeInfo | null> => {
      const win = deps.window()
      const options = { title: 'Choose your resume', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile' as const] }
      const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      const source = picked.filePaths[0]
      if (picked.canceled || !source) return null
      if (statSync(source).size > 10 * 1024 * 1024) throw new Error('That PDF is over 10 MB. Most forms take 2 MB at most.')
      copyFileSync(source, deps.resumePath)
      const info: ResumeInfo = { fileName: basename(source), addedAt: now(), pages: pdfPages(deps.resumePath), bytes: statSync(deps.resumePath).size }
      store.settings.setResume(info)
      deps.sendData(['settings'])
      return info
    },
    'settings:removeResume': () => {
      if (existsSync(deps.resumePath)) rmSync(deps.resumePath)
      store.settings.setResume(null)
      deps.sendData(['settings'])
    },
    'settings:openResume': async () => {
      if (!existsSync(deps.resumePath)) throw new Error('There is no resume yet.')
      const problem = await shell.openPath(deps.resumePath)
      if (problem) throw new Error(problem)
    },
    'settings:importResume': () => {
      if (!existsSync(deps.resumePath)) throw new Error('Add your resume first.')
      return importResume(deps.resumePath, deps.dataDir)
    },
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        return await handler(...args)
      } catch (error) {
        // A schema failure becomes its first message, not the whole report.
        if (error instanceof z.ZodError) throw new Error(error.issues[0]?.message ?? 'That input is not valid.')
        throw error
      }
    })
  }
}
