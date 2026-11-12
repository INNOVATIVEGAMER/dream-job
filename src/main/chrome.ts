import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'

import type { BrowserState } from '../shared/types'
import { Cdp } from './cdp'
import type { CdpEvent } from './cdp'

export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const START_URL = 'https://www.linkedin.com/login'

/** A Chrome that exits this soon after starting handed its window to a copy already running this profile. */
const HANDOFF_MS = 3000

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

/**
 * Runs Google Chrome with the app's own profile, in one of two modes:
 * `signin` opens it with no control link at all, for signing in to Google;
 * `controlled` adds `--remote-debugging-pipe`, a private pipe to this process
 * only, and follows one tab. No automation flags are passed, so Chrome shows
 * no "controlled by automated software" banner and pages cannot tell.
 */
export class ChromeController {
  private child: ChildProcess | null = null
  private cdp: Cdp | null = null
  private pageId: string | null = null
  private pageSession: string | null = null
  private attaching: Promise<void> | null = null
  private startedAt = 0
  private state: BrowserState = CLOSED

  /** `extraArgs` go to Chrome as given; tests pass `--headless=new` to keep it off screen. */
  constructor(
    private readonly profileDir: string,
    private readonly onChange: (state: BrowserState) => void,
    private readonly extraArgs: readonly string[] = [],
  ) {}

  current(): BrowserState {
    return this.state
  }

  async open(mode: 'signin' | 'controlled', bounds: Bounds): Promise<void> {
    if (this.child) throw new Error('Chrome is already open. Close it first.')
    mkdirSync(this.profileDir, { recursive: true })
    const args = [
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--window-position=${bounds.x},${bounds.y}`,
      `--window-size=${bounds.width},${bounds.height}`,
    ]
    if (mode === 'controlled') args.push('--remote-debugging-pipe')
    args.push(...this.extraArgs, START_URL)

    const child = spawn(CHROME_PATH, args, {
      stdio: mode === 'controlled' ? ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] : 'ignore',
    })
    this.child = child
    this.startedAt = Date.now()
    child.once('error', error => this.ended(`Chrome did not start: ${error.message}`))
    child.once('exit', () => this.ended())
    this.set({ ...CLOSED, mode, url: START_URL })

    if (mode === 'controlled') {
      const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable)
      this.cdp = cdp
      cdp.on('event', event => void this.onEvent(event).catch(error => this.fail(error)))
      await cdp.send('Target.setDiscoverTargets', { discover: true })
    }
  }

  /** Closes Chrome: politely over the pipe when controlled, by signal otherwise. */
  async close(): Promise<void> {
    const child = this.child
    if (!child) return
    if (this.cdp) {
      await this.cdp.send('Browser.close').catch(() => undefined)
      setTimeout(() => child.exitCode === null && child.kill('SIGTERM'), 2000)
    } else {
      child.kill('SIGTERM')
    }
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
  async settle(): Promise<void> {
    const deadline = Date.now() + 20_000
    await sleep(300)
    while (Date.now() < deadline) {
      const ready = await this.evaluate<string>('document.readyState', true).catch(() => 'loading')
      if (ready === 'complete') break
      await sleep(300)
    }
    await sleep(1500)
  }

  /** A real mouse click at a point in the tab's viewport, in CSS pixels. */
  async clickAt(x: number, y: number): Promise<void> {
    await this.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }

  /** Types text into whatever has focus, as real keyboard input. */
  async insertText(text: string): Promise<void> {
    await this.command('Input.insertText', { text })
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

  private async step(by: number): Promise<void> {
    const session = await this.session()
    const history = (await this.send('Page.getNavigationHistory', {}, session)) as unknown as History
    const entry = history.entries[history.currentIndex + by]
    if (entry) await this.send('Page.navigateToHistoryEntry', { entryId: entry.id }, session)
  }

  private async session(): Promise<string> {
    if (this.state.mode !== 'controlled' || !this.cdp) {
      throw new Error('Chrome is not open under the app\'s control. Press Open Chrome first.')
    }
    if (this.attaching) await this.attaching
    if (!this.pageSession) throw new Error('Chrome has no tab open yet.')

    return this.pageSession
  }

  /** A quiet command keeps its failure off the panel: polling during a page load fails on purpose. */
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
