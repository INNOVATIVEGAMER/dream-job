import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'

import type { BrowserState } from '../../shared/types'
import { Cdp } from './cdp'
import type { CdpEvent } from './cdp'
import { GUARD_SCRIPT } from './page-scripts'

const START_URL = 'about:blank'

/** A Chrome that exits this soon after starting handed its window to a copy already running this profile. */
const HANDOFF_MS = 3000

/** How long after the app's own click or key press a form submit counts as the app's doing. */
const ACTING_MS = 2500

export type Bounds = { x: number; y: number; width: number; height: number }

type TargetInfo = { targetId: string; type: string; url: string; title: string }
type History = { currentIndex: number; entries: { id: number }[] }

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const CLOSED: BrowserState = {
  mode: 'closed',
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  error: null,
}

/** Where Google Chrome is installed on this Mac, or null. */
export function findChrome(): string | null {
  const app = 'Google Chrome.app/Contents/MacOS/Google Chrome'
  const candidates = [join('/Applications', app), join(homedir(), 'Applications', app)]
  return candidates.find(path => existsSync(path)) ?? null
}

/**
 * Runs Google Chrome with the app's own profile, in one of two modes:
 * `signin` opens it with no control link at all, for signing in to Google;
 * `controlled` adds `--remote-debugging-pipe`, a private pipe to this process
 * only, and follows one tab. No automation flags are passed, so Chrome shows
 * no "controlled by automated software" banner and pages cannot tell.
 *
 * Every page the app follows gets the submit guard: a form submit that comes
 * from the app's own clicks or typing is blocked unless an approved submit
 * opened the gate first. The user's own clicks are never blocked.
 */
export class ChromeController {
  private child: ChildProcess | null = null
  private cdp: Cdp | null = null
  private pageId: string | null = null
  private pageSession: string | null = null
  private attaching: Promise<void> | null = null
  private startedAt = 0
  private state: BrowserState = CLOSED

  /** `extraArgs` go to Chrome as given, such as `--headless=new` for a check run off screen. */
  constructor(
    private readonly profileDir: string,
    private readonly onChange: (state: BrowserState) => void,
    private readonly extraArgs: readonly string[] = [],
  ) {}

  current(): BrowserState {
    return this.state
  }

  isControlled(): boolean {
    return this.state.mode === 'controlled' && this.pageSession !== null
  }

  /**
   * Opens `url` in a new tab of the sign-in window. Chrome hands a second
   * launch with the same profile to the running one and exits at once.
   */
  openInSignin(url: string): void {
    if (this.state.mode !== 'signin') throw new Error('Chrome is not open for signing in.')
    const chromePath = findChrome()
    if (!chromePath) throw new Error('Google Chrome is not installed in Applications. Install it, then try again.')
    spawn(chromePath, [`--user-data-dir=${this.profileDir}`, url], { stdio: 'ignore' }).once('error', error => this.fail(error))
  }

  async open(mode: 'signin' | 'controlled', bounds: Bounds, url = START_URL): Promise<void> {
    if (this.child) throw new Error('Chrome is already open. Close it first.')
    const chromePath = findChrome()
    if (!chromePath) throw new Error('Google Chrome is not installed in Applications. Install it, then try again.')
    mkdirSync(this.profileDir, { recursive: true })
    const args = [
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--window-position=${bounds.x},${bounds.y}`,
      `--window-size=${bounds.width},${bounds.height}`,
    ]
    if (mode === 'controlled') args.push('--remote-debugging-pipe')
    args.push(...this.extraArgs, url)

    const child = spawn(chromePath, args, {
      stdio: mode === 'controlled' ? ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] : 'ignore',
    })
    this.child = child
    this.startedAt = Date.now()
    child.once('error', error => this.ended(`Chrome did not start: ${error.message}`))
    child.once('exit', () => this.ended())
    this.set({ ...CLOSED, mode, url })

    if (mode === 'controlled') {
      const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable)
      this.cdp = cdp
      cdp.on('event', event => void this.onEvent(event).catch(error => this.fail(error)))
      await cdp.send('Target.setDiscoverTargets', { discover: true })
    }
  }

  /** Waits until a tab is followed, up to `ms`. */
  async ready(ms = 10_000): Promise<void> {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (this.pageSession) return
      if (this.attaching) await this.attaching
      else await sleep(150)
    }
    throw new Error('Chrome opened, but no tab was ready in time.')
  }

  /** Closes Chrome: politely over the pipe when controlled, by signal otherwise. */
  /** Closes Chrome and resolves once it has exited. */
  async close(): Promise<void> {
    const child = this.child
    if (!child) return
    const exited = new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.once('exit', () => resolve())
    })
    if (this.cdp) {
      await this.cdp.send('Browser.close').catch(() => undefined)
      setTimeout(() => child.exitCode === null && child.kill('SIGTERM'), 2000)
    } else {
      child.kill('SIGTERM')
    }
    const last = setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'), 6000)
    await exited
    clearTimeout(last)
  }

  /** Sends one command to the followed tab. */
  async command(method: string, params: Record<string, unknown> = {}, isQuiet = false): Promise<Record<string, unknown>> {
    return this.send(method, params, await this.session(), isQuiet)
  }

  /** Runs JavaScript in the followed tab and answers its value. */
  async evaluate<T>(expression: string, isQuiet = false): Promise<T> {
    const answer = (await this.command(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      isQuiet,
    )) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }
    if (answer.exceptionDetails) {
      throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text ?? 'the page script failed')
    }

    return answer.result?.value as T
  }

  /** The followed tab's address and title. */
  async page(): Promise<{ url: string; title: string }> {
    return this.evaluate<{ url: string; title: string }>('({ url: location.href, title: document.title })')
  }

  /**
   * Opens a URL in the followed tab and waits for it to finish loading, then a
   * little longer: pages such as LinkedIn fill in their lists after load.
   */
  async openPage(url: string): Promise<void> {
    const answer = (await this.command('Page.navigate', { url })) as { errorText?: string }
    if (answer.errorText) throw new Error(`the page did not open: ${answer.errorText}`)
    await this.settle()
  }

  /** Waits for the tab to finish loading after a navigation, up to 20 s, then a little longer. */
  async settle(extraMs = 1500): Promise<void> {
    const deadline = Date.now() + 20_000
    await sleep(300)
    while (Date.now() < deadline) {
      const ready = await this.evaluate<string>('document.readyState', true).catch(() => 'loading')
      if (ready === 'complete') break
      await sleep(300)
    }
    await sleep(extraMs)
  }

  /** A real mouse click at a point in the tab's viewport, in CSS pixels. Marks the app as acting, for the guard. */
  async clickAt(x: number, y: number): Promise<void> {
    await this.markActing()
    await this.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }

  /** Types text into whatever has focus, as real keyboard input. */
  async insertText(text: string): Promise<void> {
    await this.markActing()
    await this.command('Input.insertText', { text })
  }

  /** Scrolls the page under a point, as a mouse wheel would. */
  async scroll(deltaY: number, x = 400, y = 400): Promise<void> {
    await this.command('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
    await sleep(600)
  }

  /** Opens the guard for one submit the user approved, for a few seconds. */
  async allowSubmit(ms = 8000): Promise<void> {
    await this.evaluate(`window.__jobappGuard && (window.__jobappGuard.until = Date.now() + ${ms})`, true).catch(() => undefined)
  }

  /** Whether the guard blocked a submit at or after `since`, a time in ms. */
  async blockedSince(since: number): Promise<boolean> {
    const at = await this.evaluate<number>('(window.__jobappGuard && window.__jobappGuard.blocked) || 0', true).catch(() => 0)
    return at >= since
  }

  /**
   * Presses one key as real keyboard input, with Shift held when asked:
   * Shift+Enter starts a new line in a message box without sending it.
   */
  async pressKey(key: 'Enter' | 'Backspace' | 'Escape', withShift = false): Promise<void> {
    await this.markActing()
    const codes = { Enter: 13, Backspace: 8, Escape: 27 }
    const base = { key, code: key, windowsVirtualKeyCode: codes[key], modifiers: withShift ? 8 : 0 }
    await this.command('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key === 'Enter' ? { text: '\r' } : {}) })
    await this.command('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /**
   * Puts files into the file input an expression answers, as a person
   * choosing them would. Works inside shadow roots, which selectors miss.
   */
  async setFilesAt(expression: string, files: string[]): Promise<void> {
    const answer = (await this.command('Runtime.evaluate', { expression, returnByValue: false })) as { result?: { objectId?: string } }
    const objectId = answer.result?.objectId
    if (!objectId) throw new Error('The file field is no longer on the page.')
    await this.command('DOM.setFileInputFiles', { objectId, files })
  }

  /** Puts files into a file input the page matches with `selector`, as a person choosing them would. */
  async setFiles(selector: string, files: string[]): Promise<void> {
    const { root } = (await this.command('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } }
    const { nodeId } = (await this.command('DOM.querySelector', { nodeId: root.nodeId, selector })) as { nodeId: number }
    if (!nodeId) throw new Error('The file field is no longer on the page. Read the page again.')
    await this.command('DOM.setFileInputFiles', { nodeId, files })
  }

  async bringToFront(): Promise<void> {
    await this.command('Page.bringToFront').catch(() => undefined)
  }

  async navigate(url: string): Promise<void> {
    const session = await this.session()
    await this.send('Page.navigate', { url }, session)
    await this.send('Page.bringToFront', {}, session)
  }

  async back(): Promise<void> {
    await this.step(-1)
  }

  async forward(): Promise<void> {
    await this.step(1)
  }

  async reload(): Promise<void> {
    await this.send('Page.reload', {}, await this.session())
  }

  private async markActing(): Promise<void> {
    await this.evaluate(`window.__jobappGuard && (window.__jobappGuard.acting = Date.now() + ${ACTING_MS})`, true).catch(() => undefined)
  }

  private async step(by: number): Promise<void> {
    const session = await this.session()
    const history = (await this.send('Page.getNavigationHistory', {}, session)) as unknown as History
    const entry = history.entries[history.currentIndex + by]
    if (entry) await this.send('Page.navigateToHistoryEntry', { entryId: entry.id }, session)
  }

  private async session(): Promise<string> {
    if (this.state.mode !== 'controlled' || !this.cdp) {
      throw new Error("Chrome is not open under the app's control.")
    }
    if (this.attaching) await this.attaching
    if (!this.pageSession) throw new Error('Chrome has no tab open yet.')

    return this.pageSession
  }

  /** A quiet command keeps its failure off the screens: polling during a page load fails on purpose. */
  private async send(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
    isQuiet = false,
  ): Promise<Record<string, unknown>> {
    if (!this.cdp) throw new Error('Chrome is not connected')
    try {
      const result = await this.cdp.send(method, params, sessionId)
      if (this.state.error && !isQuiet) this.set({ error: null })
      return result
    } catch (error) {
      if (!isQuiet) this.fail(error)
      throw error
    }
  }

  /** Follows one tab: the first page Chrome reports, then another when it closes. */
  private async onEvent(event: CdpEvent): Promise<void> {
    if (event.method === 'Target.targetCreated' || event.method === 'Target.targetInfoChanged') {
      const info = event.params.targetInfo as TargetInfo
      if (info.type !== 'page') return
      if (!this.pageId) await this.follow(info.targetId)
      if (info.targetId === this.pageId) {
        this.set({ url: info.url, title: info.title })
        await this.refreshHistory()
      }
    } else if (event.method === 'Target.targetDestroyed' && event.params.targetId === this.pageId) {
      this.pageId = null
      this.pageSession = null
      const { targetInfos } = (await this.send('Target.getTargets', {})) as { targetInfos?: TargetInfo[] }
      const next = targetInfos?.find(one => one.type === 'page')
      if (next) {
        await this.follow(next.targetId)
        this.set({ url: next.url, title: next.title })
      } else {
        this.set({ url: '', title: '', canGoBack: false, canGoForward: false })
      }
    }
  }

  private async follow(targetId: string): Promise<void> {
    if (this.attaching) return this.attaching
    this.pageId = targetId
    this.attaching = (async () => {
      const { sessionId } = (await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string }
      // The guard goes into every document this tab loads from now on, and the one already open.
      await this.send('Page.enable', {}, sessionId).catch(() => undefined)
      await this.send('Page.addScriptToEvaluateOnNewDocument', { source: GUARD_SCRIPT }, sessionId).catch(() => undefined)
      await this.send('Runtime.evaluate', { expression: GUARD_SCRIPT }, sessionId, true).catch(() => undefined)
      this.pageSession = sessionId
    })().finally(() => {
      this.attaching = null
    })

    return this.attaching
  }

  private async refreshHistory(): Promise<void> {
    if (!this.pageSession) return
    const history = (await this.send('Page.getNavigationHistory', {}, this.pageSession)) as unknown as History
    this.set({
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
    })
  }

  private ended(reason?: string): void {
    if (!this.child) return
    const quick = Date.now() - this.startedAt < HANDOFF_MS
    this.child = null
    this.cdp = null
    this.pageId = null
    this.pageSession = null
    this.attaching = null
    const error =
      reason ??
      (quick
        ? 'Chrome closed straight away: this profile is probably already open in another Chrome window. Close that window, then try again.'
        : null)
    this.set({ ...CLOSED, error })
  }

  private fail(error: unknown): void {
    this.set({ error: error instanceof Error ? error.message : String(error) })
  }

  private set(patch: Partial<BrowserState>): void {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }
}
