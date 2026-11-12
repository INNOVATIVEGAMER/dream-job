import { contextBridge, ipcRenderer } from 'electron'

import type { BrowserInfo, BrowserState, ClaudeStatus, FlowState, TrackerPage } from '../shared/types'

/** The only door from the panel to the main process. */
const api = {
  openChrome: (mode: 'signin' | 'controlled'): Promise<void> => ipcRenderer.invoke('chrome:open', mode),
  closeChrome: (): Promise<void> => ipcRenderer.invoke('chrome:close'),
  navigate: (input: string): Promise<boolean> => ipcRenderer.invoke('browser:navigate', input),
  back: (): Promise<void> => ipcRenderer.invoke('browser:back'),
  forward: (): Promise<void> => ipcRenderer.invoke('browser:forward'),
  reload: (): Promise<void> => ipcRenderer.invoke('browser:reload'),
  requestState: (): Promise<void> => ipcRenderer.invoke('browser:state'),
  info: (): Promise<BrowserInfo> => ipcRenderer.invoke('browser:info'),
  onState: (listener: (state: BrowserState) => void): (() => void) => {
    const handler = (_event: unknown, state: BrowserState): void => listener(state)
    ipcRenderer.on('browser:state', handler)
    return () => ipcRenderer.removeListener('browser:state', handler)
  },
  openTracker: (): Promise<void> => ipcRenderer.invoke('tracker:open'),
  trackerPage: (filter: string, page: number): Promise<TrackerPage> => ipcRenderer.invoke('tracker:page', filter, page),
  setStatus: (id: number, status: string): Promise<void> => ipcRenderer.invoke('tracker:set-status', id, status),
  runHunt: (url: string): Promise<void> => ipcRenderer.invoke('flow:hunt', url),
  runFormTest: (): Promise<void> => ipcRenderer.invoke('flow:form'),
  runHandoverTest: (): Promise<void> => ipcRenderer.invoke('flow:handover-test'),
  resume: (id: string): Promise<void> => ipcRenderer.invoke('flow:resume', id),
  approve: (id: string, texts: string[]): Promise<void> => ipcRenderer.invoke('flow:approve', id, texts),
  cancelApproval: (id: string): Promise<void> => ipcRenderer.invoke('flow:cancel', id),
  stopFlow: (): Promise<void> => ipcRenderer.invoke('flow:stop'),
  requestFlow: (): Promise<void> => ipcRenderer.invoke('flow:state'),
  onFlow: (listener: (state: FlowState) => void): (() => void) => {
    const handler = (_event: unknown, state: FlowState): void => listener(state)
    ipcRenderer.on('flow:state', handler)
    return () => ipcRenderer.removeListener('flow:state', handler)
  },
  checkClaude: (): Promise<void> => ipcRenderer.invoke('claude:check'),
  requestClaudeStatus: (): Promise<void> => ipcRenderer.invoke('claude:status'),
  onClaudeStatus: (listener: (status: ClaudeStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: ClaudeStatus): void => listener(status)
    ipcRenderer.on('claude:status', handler)
    return () => ipcRenderer.removeListener('claude:status', handler)
  },
}

contextBridge.exposeInMainWorld('jobApp', api)

export type JobAppApi = typeof api
