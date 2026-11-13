import { contextBridge, ipcRenderer } from 'electron'

import type { JobAppApi } from '../shared/api'
import type { AppStatus, DataTopic } from '../shared/types'

// The main process checks every input and answers the types in JobAppApi; `never` lets each entry take its own signature.
const call =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: unknown, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** The only door from the screens to the main process. */
const api: JobAppApi = {
  status: call('status'),
  onStatus: listener => listen<AppStatus>('push:status', listener),
  onData: listener => listen<DataTopic[]>('push:data', listener),
  checkClaude: call('checkClaude'),
  chrome: {
    open: call('chrome:open'),
    close: call('chrome:close'),
    front: call('chrome:front'),
    openUrl: call('chrome:openUrl'),
    signIn: call('chrome:signIn'),
    info: call('chrome:info'),
  },
  home: call('home'),
  tracker: {
    page: call('tracker:page'),
    get: call('tracker:get'),
    setStatus: call('tracker:setStatus'),
    setNotes: call('tracker:setNotes'),
    add: call('tracker:add'),
  },
  discarded: {
    page: call('discarded:page'),
    restore: call('discarded:restore'),
    neverShow: call('discarded:neverShow'),
    addNeverShow: call('discarded:addNeverShow'),
    removeNeverShow: call('discarded:removeNeverShow'),
  },
  contacts: {
    page: call('contacts:page'),
    ready: call('contacts:ready'),
    applied: call('contacts:applied'),
    get: call('contacts:get'),
    markThanked: call('contacts:markThanked'),
  },
  runs: {
    page: call('runs:page'),
    get: call('runs:get'),
    answer: call('runs:answer'),
    stop: call('runs:stop'),
    showTab: call('runs:showTab'),
  },
  flows: {
    hunt: call('flows:hunt'),
    apply: call('flows:apply'),
    connect: call('flows:connect'),
    referral: call('flows:referral'),
    checkAccepted: call('flows:checkAccepted'),
    email: call('flows:email'),
  },
  email: {
    detail: call('email:detail'),
    undo: call('email:undo'),
    waiting: call('email:waiting'),
    add: call('email:add'),
    ignore: call('email:ignore'),
  },
  settings: {
    get: call('settings:get'),
    setPreferences: call('settings:setPreferences'),
    setProfile: call('settings:setProfile'),
    setReferral: call('settings:setReferral'),
    setPortals: call('settings:setPortals'),
    setEmail: call('settings:setEmail'),
    finishSetup: call('settings:finishSetup'),
    answers: call('settings:answers'),
    saveAnswer: call('settings:saveAnswer'),
    removeAnswer: call('settings:removeAnswer'),
    sites: call('settings:sites'),
    chooseResume: call('settings:chooseResume'),
    removeResume: call('settings:removeResume'),
    openResume: call('settings:openResume'),
    importResume: call('settings:importResume'),
  },
}

contextBridge.exposeInMainWorld('jobApp', api)
