import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename } from 'node:path'

import { dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'

import type { Channel, JobDetail, RunDetail } from '../shared/api'
import { cleanLink } from '../shared/links'
import { OUTREACH_STATES, SIGN_IN_SITES, SIGN_IN_URLS, STAGES, STATUSES, WORK_MODES } from '../shared/types'
import type { AppStatus, DataTopic, ResumeInfo } from '../shared/types'
import type { ChromeController } from './browser/chrome'
import { findChrome } from './browser/chrome'
import { readSignIns } from './browser/signins'
import { modelOption } from './claude'
import type { ChatService } from './chat/service'
import { now } from './db/database'
import { ModelSchema } from './db/settings'
import type { Store } from './db/store'
import type { Flows } from './flows'
import { importResume } from './flows/resume'
import type { RunEngine } from './runs/engine'
import { CardAnswerSchema, CompanyEdit, CompanyQuery, ConnectOptions, HuntOptions, id, JobEdit, NewJob, ReferralOptions, RunQuery, short } from './schemas'

export type IpcDeps = {
  store: Store
  chrome: ChromeController
  engine: RunEngine
  chat: ChatService
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

    'tracker:companies': query => store.trackerList(CompanyQuery.parse(query)),
    'tracker:get': (jobId): JobDetail | null => store.jobDetail(id.parse(jobId)),
    'tracker:setStatus': (jobId, status) => {
      store.jobs.setStatus(id.parse(jobId), z.enum(STATUSES).parse(status))
      deps.sendData(['jobs'])
    },
    'tracker:setNotes': (jobId, notes) => {
      store.jobs.setNotes(id.parse(jobId), short(20_000).parse(notes))
      deps.sendData(['jobs'])
    },
    'tracker:edit': (jobId, change) => {
      store.editJob(id.parse(jobId), JobEdit.parse(change))
      deps.sendData(['jobs'])
    },
    'tracker:setWorkMode': (jobId, workMode) => {
      store.jobs.setWorkMode(id.parse(jobId), z.enum(WORK_MODES).parse(workMode))
      deps.sendData(['jobs'])
    },
    'tracker:add': input => {
      const job = NewJob.parse(input)
      const jobId = store.transaction(() => store.jobs.addManual({ ...job, link: cleanLink(job.link) }))
      deps.sendData(['jobs'])
      return jobId
    },
    'tracker:restore': jobId => {
      store.jobs.restore(id.parse(jobId))
      deps.sendData(['jobs'])
    },
    'tracker:setStarred': (jobIds, starred) => {
      store.jobs.setStarred(z.array(id).max(5000).parse(jobIds), z.boolean().parse(starred))
      deps.sendData(['jobs'])
    },

    'companies:get': companyId => store.companyDetail(id.parse(companyId)),
    'companies:names': () => store.companies.names(),
    'companies:setStage': (companyId, stage) => {
      store.companies.setStage(id.parse(companyId), z.enum(STAGES).parse(stage))
      deps.sendData(['jobs'])
    },
    'companies:setNotes': (companyId, notes) => {
      store.companies.setNotes(id.parse(companyId), short(20_000).parse(notes))
      deps.sendData(['jobs'])
    },
    'companies:setNeverShow': (companyId, on, why) => {
      store.companies.setNeverShow(id.parse(companyId), z.boolean().parse(on), short(500).parse(why ?? ''))
      deps.sendData(['jobs'])
    },
    'companies:edit': (companyId, change) => {
      store.editCompany(id.parse(companyId), CompanyEdit.parse(change))
      deps.sendData(['jobs', 'people'])
    },
    'companies:merge': (fromId, intoId) => {
      store.transaction(() => store.companies.merge(id.parse(fromId), id.parse(intoId)))
      deps.sendData(['jobs', 'people'])
    },
    'companies:neverShown': () => store.neverShow.list(),
    'companies:addNeverShow': (company, why) => {
      store.neverShow.add(short().parse(company), short(500).parse(why))
      deps.sendData(['jobs'])
    },

    'outreach:setState': (outreachId, state) => {
      store.setOutreachState(id.parse(outreachId), z.enum(OUTREACH_STATES).parse(state))
      deps.sendData(['jobs', 'people'])
    },

    'runs:page': query => store.runs.page(RunQuery.parse(query)),
    'runs:get': (runId): RunDetail | null => {
      const summary = store.runs.get(id.parse(runId))
      return summary ? { summary, events: store.runs.events(summary.id), state: store.runState(summary.id) } : null
    },
    'runs:answer': (cardId, answer) => deps.engine.answer(short().parse(cardId), CardAnswerSchema.parse(answer)),
    'runs:stop': () => deps.engine.stop(),
    'runs:showTab': key => deps.engine.showTab(short().parse(key)),
    'runs:leave': key => deps.engine.leave(short().parse(key)),
    'runs:setField': async (key, field, value) => {
      await deps.engine.setField(short().parse(key), short().parse(field), z.string().max(20_000).nullable().parse(value), 'you')
    },
    'runs:jobs': runId => store.jobs.byRun(id.parse(runId)),
    'runs:discarded': runId => store.jobs.discardedByRun(id.parse(runId)),

    'flows:hunt': options => deps.flows.hunt(HuntOptions.parse(options)),
    'flows:apply': jobIds => deps.flows.apply(z.array(id).min(1, 'Pick at least one job.').parse(jobIds)),
    'flows:checkPostings': jobIds => deps.flows.checkPostings(z.array(id).parse(jobIds ?? [])),
    'flows:connect': options => deps.flows.connect(ConnectOptions.parse(options)),
    'flows:refreshPeople': companyIds => deps.flows.refreshPeople(z.array(id).min(1, 'Pick at least one company.').parse(companyIds)),
    'flows:referral': options => deps.flows.referral(ReferralOptions.parse(options)),
    'flows:checkAccepted': () => deps.flows.checkAccepted(),
    'flows:email': options => deps.flows.email(z.object({ count: z.number().int().optional() }).parse(options ?? {})),

    'email:detail': runId => store.emailDetail(id.parse(runId)),
    'email:undo': activityId => {
      store.undoEmailChange(id.parse(activityId))
      deps.sendData(['email', 'jobs', 'people'])
    },

    'chat:state': () => deps.chat.state(),
    'chat:list': () => deps.chat.list(),
    'chat:open': chatId => deps.chat.open(id.parse(chatId)),
    'chat:startNew': () => deps.chat.startNew(),
    'chat:send': (text, route) => deps.chat.send(short(20_000).parse(text), short(200).parse(route)),
    'chat:stop': () => deps.chat.stop(),
    'chat:answer': (cardId, answer) => deps.chat.answer(short().parse(cardId), CardAnswerSchema.parse(answer)),
    'chat:remove': chatId => deps.chat.remove(id.parse(chatId)),
    'chat:showTab': () => deps.chat.showTab(),
    'chat:setModel': model => deps.chat.setModel(ModelSchema.nullable().parse(model)),

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
    'settings:setModel': async value => {
      store.settings.setModel(value)
      deps.sendData(['settings'])
      await deps.chat.defaultChanged()
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
      return importResume(deps.resumePath, deps.dataDir, modelOption(store.settings.model()))
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
