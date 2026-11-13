import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow, screen } from 'electron'

import type { AppStatus, ClaudeStatus, DataTopic, RunState } from '../shared/types'
import { ChromeController } from './browser/chrome'
import type { Bounds } from './browser/chrome'
import { checkClaude } from './claude'
import { Store } from './db/store'
import { Flows } from './flows'
import { registerIpc } from './ipc'
import { RunEngine } from './runs/engine'

// One data folder for the app from the repository and the packaged app alike,
// whatever name each runs under. Dream Job was first called Job App: its folder moves
// to the new name once, on the first start after the rename, sign-ins and all.
const dataFolder = join(app.getPath('appData'), 'dream-job')
const oldDataFolder = join(app.getPath('appData'), 'job-app')
if (!existsSync(dataFolder) && existsSync(oldDataFolder)) renameSync(oldDataFolder, dataFolder)
app.setPath('userData', dataFolder)

/** Everything the app keeps lives in its own folder on this Mac, outside any repository. */
const dataDir = app.getPath('userData')
const dbPath = join(dataDir, 'job.db')
const resumePath = join(dataDir, 'resume.pdf')
const chromeProfileDir = join(dataDir, 'chrome-profile')

const WINDOW = { width: 1200, height: 860 }
const GAP = 8

let win: BrowserWindow | null = null
let claude: ClaudeStatus = { state: 'checking', message: 'Checking Claude Code...', path: null, version: null, account: null }
let checking: Promise<void> | null = null

/**
 * When run from the repository with no data of its own yet, the app starts
 * from the rows the developer keeps in `data/job.db`. A packaged app starts empty.
 */
function seedFromRepository(): void {
  mkdirSync(dataDir, { recursive: true })
  const seed = join(app.getAppPath(), 'data', 'job.db')
  if (!app.isPackaged && !existsSync(dbPath) && existsSync(seed)) copyFileSync(seed, dbPath)
}

seedFromRepository()
const store = Store.open(dbPath)
store.runs.closeAbandoned()

function status(): AppStatus {
  return { claude, browser: chrome.current(), run: engine.current() }
}

function pushStatus(): void {
  win?.webContents.send('push:status', status())
}

function pushData(topics: DataTopic[]): void {
  win?.webContents.send('push:data', topics)
}

/** Chrome opens to the right of the app's window, filling the rest of that screen. */
function chromeBounds(): Bounds {
  const panel = win?.getBounds() ?? { x: 0, y: 0, ...WINDOW }
  const area = screen.getDisplayMatching(panel).workArea
  const x = panel.x + panel.width + GAP
  const width = area.x + area.width - x
  return width >= 700
    ? { x, y: panel.y, width, height: panel.height }
    : { x: area.x + Math.round(area.width * 0.35), y: area.y, width: Math.round(area.width * 0.65), height: area.height }
}

// Each time Chrome opens or closes, the screens read the sign-ins again.
let chromeMode = 'closed'
const chrome = new ChromeController(chromeProfileDir, state => {
  pushStatus()
  if (state.mode !== chromeMode) {
    chromeMode = state.mode
    pushData(['sites'])
  }
})

async function openChrome(mode: 'signin' | 'controlled', url?: string): Promise<void> {
  if (chrome.current().mode === mode) return chrome.bringToFront()
  if (chrome.current().mode !== 'closed') {
    throw new Error(
      mode === 'controlled'
        ? 'Chrome is open for signing in. Close that Chrome window (Cmd+Q), then try again.'
        : 'Chrome is open under the app\'s control. Close it first, then open it to sign in.',
    )
  }
  await chrome.open(mode, chromeBounds(), url)
  if (mode === 'controlled') await chrome.ready()
}

const engine = new RunEngine({
  store,
  chrome,
  resumePath,
  cwd: dataDir,
  ensureChrome: async () => {
    if (!chrome.isControlled()) await openChrome('controlled')
  },
  onState: (_state: RunState | null) => pushStatus(),
  onData: topics => pushData(topics),
  onAttention: () => {
    win?.show()
    win?.focus()
  },
})
const flows = new Flows(engine, store)

/** One check at a time; a second request while one runs waits for it. */
function runClaudeCheck(): Promise<void> {
  checking ??= (async () => {
    claude = { ...claude, state: 'checking', message: 'Checking Claude Code...' }
    pushStatus()
    // Claude Code runs in the app's own data folder, never in a project.
    claude = await checkClaude(dataDir)
    pushStatus()
  })().finally(() => {
    checking = null
  })
  return checking
}

/** The app's screens load nothing from the network and open no other windows. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ')

function createWindow(): void {
  const area = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: Math.min(WINDOW.width, area.width),
    height: Math.min(WINDOW.height, area.height),
    minWidth: 880,
    minHeight: 620,
    title: 'Dream Job',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  const contents = win.webContents
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

registerIpc({
  store,
  chrome,
  engine,
  flows,
  window: () => win,
  status,
  checkClaude: runClaudeCheck,
  openChrome,
  sendData: pushData,
  resumePath,
  chromeProfileDir,
  dataDir,
})

void app.whenReady().then(() => {
  createWindow()
  // Once Claude Code checks out, the email check runs if the user asked for it at start-up.
  void runClaudeCheck().then(() => (claude.state === 'ok' ? flows.emailOnOpen() : undefined))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void engine.stop()
  void chrome.close()
})
app.on('will-quit', () => store.close())
app.on('window-all-closed', () => app.quit())
