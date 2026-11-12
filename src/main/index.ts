import { join } from 'node:path'

import { app, BrowserWindow, ipcMain, screen } from 'electron'

import type { BrowserInfo, BrowserState, ClaudeStatus, FlowState } from '../shared/types'
import { CHROME_PATH, ChromeController } from './chrome'
import type { Bounds } from './chrome'
import { checkClaude } from './claude'
import { FlowRunner } from './flows'
import { Tracker } from './tracker'

/** The app's own window: the panel. Chrome opens as its own window beside it. */
const PANEL_WIDTH = 460
const GAP = 8

let win: BrowserWindow | null = null
let chrome: ChromeController | null = null
let flows: FlowRunner | null = null
let tracker: Tracker | null = null
let trackerWin: BrowserWindow | null = null

const PRELOAD = (): string => join(__dirname, '../preload/index.js')

/** Loads the renderer into a window; `hash` picks the screen (`tracker`, or the panel when empty). */
function loadScreen(target: BrowserWindow, hash = ''): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void target.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  else void target.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

/** The tracker's own window: wide enough for a real table. One at a time. */
function openTracker(): void {
  if (trackerWin) {
    trackerWin.show()
    trackerWin.focus()
    return
  }
  trackerWin = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 500,
    title: 'Tracker',
    webPreferences: { preload: PRELOAD(), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  trackerWin.on('closed', () => {
    trackerWin = null
  })
  loadScreen(trackerWin, 'tracker')
}

let shownCard: string | null = null

function sendFlow(state: FlowState): void {
  win?.webContents.send('flow:state', state)
  // A submit waiting for approval, or a hand-over, brings the app to the front, once per card.
  const card = state.approval?.id ?? state.handover?.id ?? null
  if (card && card !== shownCard) {
    shownCard = card
    win?.show()
    win?.focus()
  }
}

function sendState(state: BrowserState): void {
  win?.webContents.send('browser:state', state)
}

/** Accepts "linkedin.com" as well as a full URL; refuses anything but http and https. */
function toUrl(input: string): string | null {
  const text = input.trim()
  if (text === '') return null
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Where Chrome opens: to the right of the panel, filling the rest of that screen. */
function chromeBounds(): Bounds {
  const panel = win?.getBounds() ?? { x: 0, y: 0, width: PANEL_WIDTH, height: 900 }
  const area = screen.getDisplayMatching(panel).workArea
  const x = panel.x + panel.width + GAP

  return { x, y: panel.y, width: Math.max(800, area.x + area.width - x), height: panel.height }
}

function createWindow(): void {
  const area = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: PANEL_WIDTH,
    height: area.height,
    minWidth: 380,
    minHeight: 600,
    title: 'Job App',
    webPreferences: {
      preload: PRELOAD(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.on('closed', () => {
    win = null
  })
  loadScreen(win)
}

let claudeStatus: ClaudeStatus = {
  state: 'checking',
  message: 'Not checked yet.',
  path: null,
  version: null,
  account: null,
}
let checking: Promise<void> | null = null

function sendClaude(status: ClaudeStatus): void {
  claudeStatus = status
  win?.webContents.send('claude:status', status)
}

/** One check at a time; a second request while one runs waits for it. */
function runClaudeCheck(): Promise<void> {
  checking ??= (async () => {
    sendClaude({ ...claudeStatus, state: 'checking', message: 'Checking Claude Code...' })
    // Claude Code runs in the app's own data folder, never in a project.
    sendClaude(await checkClaude(app.getPath('userData')))
  })().finally(() => {
    checking = null
  })

  return checking
}

/** Runs a Chrome command; a failure is already on the panel through the state's error. */
const quietly = (work: Promise<unknown>): Promise<void> => work.then(() => undefined).catch(() => undefined)

ipcMain.handle('chrome:open', (_event, mode: unknown) => {
  if (!chrome || (mode !== 'signin' && mode !== 'controlled')) return
  return quietly(chrome.open(mode, chromeBounds()))
})
ipcMain.handle('chrome:close', () => quietly(chrome?.close() ?? Promise.resolve()))
ipcMain.handle('browser:navigate', (_event, input: unknown) => {
  const url = typeof input === 'string' ? toUrl(input) : null
  if (!url || !chrome) return false
  return quietly(chrome.navigate(url)).then(() => true)
})
ipcMain.handle('browser:back', () => quietly(chrome?.back() ?? Promise.resolve()))
ipcMain.handle('browser:forward', () => quietly(chrome?.forward() ?? Promise.resolve()))
ipcMain.handle('browser:reload', () => quietly(chrome?.reload() ?? Promise.resolve()))
ipcMain.handle('browser:state', () => chrome && sendState(chrome.current()))
ipcMain.handle('claude:check', () => runClaudeCheck())
ipcMain.handle('flow:hunt', (_event, url: unknown) => {
  if (typeof url === 'string') void flows?.runMiniHunt(url)
})
ipcMain.handle('flow:form', () => {
  void flows?.runFormTest()
})
ipcMain.handle('flow:handover-test', () => {
  void flows?.runHandoverTest()
})
ipcMain.handle('flow:resume', (_event, id: unknown) => {
  if (typeof id === 'string') flows?.resume(id)
})
ipcMain.handle('flow:approve', (_event, id: unknown, texts: unknown) => {
  if (typeof id === 'string' && Array.isArray(texts) && texts.every(text => typeof text === 'string')) {
    flows?.approve(id, texts as string[])
  }
})
ipcMain.handle('flow:cancel', (_event, id: unknown) => {
  if (typeof id === 'string') flows?.cancel(id)
})
ipcMain.handle('flow:stop', () => flows?.stop())
ipcMain.handle('tracker:open', () => openTracker())
ipcMain.handle('tracker:page', (_event, filter: unknown, page: unknown) =>
  tracker?.page(typeof filter === 'string' ? filter : 'all', typeof page === 'number' ? page : 0),
)
ipcMain.handle('tracker:set-status', (_event, id: unknown, status: unknown) => {
  if (typeof id !== 'number' || typeof status !== 'string') throw new Error('id and status are required')
  tracker?.setStatus(id, status)
})
ipcMain.handle('flow:state', () => flows && sendFlow(flows.current()))
ipcMain.handle('claude:status', () => sendClaude(claudeStatus))
ipcMain.handle(
  'browser:info',
  (): BrowserInfo => ({ chromePath: CHROME_PATH, profileDir: join(app.getPath('userData'), 'chrome-profile') }),
)

void app.whenReady().then(() => {
  // Chrome's profile lives with the app's data, outside the repository, so
  // its cookies never reach git.
  chrome = new ChromeController(join(app.getPath('userData'), 'chrome-profile'), sendState)
  flows = new FlowRunner(chrome, app.getPath('userData'), sendFlow)
  // The tracker's data lives in the repo, beside the code: data/job.db.
  tracker = new Tracker(join(app.getAppPath(), 'data', 'job.db'))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void chrome?.close()
  tracker?.close()
  tracker = null
})
app.on('window-all-closed', () => app.quit())
