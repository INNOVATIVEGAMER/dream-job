import type { ChromeController, Tab } from '../browser/chrome'
import { PageDriver } from '../browser/chrome'

/** Errors that mean the tab is gone: Chrome closed, or the user closed the tab. */
const GONE = /not connected|not open|no target|target closed|session.*not found|session closed/i

/**
 * The chat's own Chrome tab, opened the first time a tool needs it, so the
 * chat never works in the tab a run follows. Opens Chrome under the app's
 * control when it is closed, and opens a fresh tab when this one is gone.
 */
export class ChatTab extends PageDriver {
  private tab: Tab | null = null
  private opening: Promise<Tab> | null = null
  private isShown = false

  constructor(
    private readonly chrome: ChromeController,
    private readonly ensureChrome: () => Promise<void>,
  ) {
    super()
  }

  private current(): Promise<Tab> {
    if (this.tab) return Promise.resolve(this.tab)
    this.opening ??= (async () => {
      await this.ensureChrome()
      const tab = await this.chrome.openTab()
      this.tab = tab
      this.isShown = false
      return tab
    })().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  protected async session(): Promise<string> {
    // Every command goes through `send`, which uses the tab's own session.
    return ''
  }

  protected async send(method: string, params: Record<string, unknown>, _sessionId?: string, isQuiet = false): Promise<Record<string, unknown>> {
    const tab = await this.current()
    try {
      return await tab.command(method, params, isQuiet)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.tab !== tab || (this.chrome.isControlled() && !GONE.test(message))) throw error
      // The tab is gone: open another and try once more.
      this.tab = null
      const fresh = await this.current()
      return fresh.command(method, params, isQuiet)
    }
  }

  /** Opens a page, and the first time, brings the tab forward so the user sees where the chat works. */
  override async openPage(url: string): Promise<void> {
    await super.openPage(url)
    if (!this.isShown) {
      this.isShown = true
      await this.bringToFront()
    }
  }

  /** Shows the tab, when there is one. */
  async show(): Promise<boolean> {
    if (!this.tab) return false
    await this.bringToFront()
    return true
  }

  async close(): Promise<void> {
    const tab = this.tab
    this.tab = null
    await tab?.close().catch(() => undefined)
  }
}
