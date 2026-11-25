import { answerOf, isPending, sameAnswer } from '../../shared/form'
import type { ApplicationForm, FormField } from '../../shared/types'
import { setField } from './actions'
import type { PageDriver } from './chrome'
import { fieldKeysScript, fieldRefScript, FORM_SCRIPT } from './page-scripts'
import type { PageForm } from './page-scripts'

/** How often the app sets an answer itself before the step goes to Claude. */
const MAX_TRIES = 2

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const originOf = (url: string): string => {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/** A field as the app follows it: what the screens see, and what it keeps to itself. */
type Followed = FormField & {
  /** The dialog or form it was read in. */
  group: string
  /** Where it sat on its page at the last reading. */
  order: number
  /** Who set `wanted`: once the page holds it, the answer is theirs again whoever typed over it in between. */
  wantedBy: 'you' | 'chat' | null
  /** The answer of the user's Claude was last asked to set, in passing. */
  asked: string | null
  /** The answer of the user's Claude was last sent back for, from the submit. */
  sentBack: string | null
  /** The answer of the user's Claude was last told to leave alone. */
  told: string | null
  /** How often the app tried to set the user's answer itself. */
  tries: number
}

function shown(field: Followed): FormField {
  const { group: _group, order: _order, wantedBy: _wantedBy, asked: _asked, sentBack: _sentBack, told: _told, tries: _tries, ...rest } = field
  return rest
}

const line = (field: Followed, answer: string): string => `- ${field.label}${field.page > 1 ? ` (page ${field.page})` : ''}: "${answer}"`

export type LiveFormHooks = {
  /** Claude is between actions or held on a card: the app may type in the tab itself. */
  canWrite: () => boolean
  /** The session waits on the user: a change on the page is theirs. */
  isUsersTurn: () => boolean
  onChange: (form: ApplicationForm) => void
}

/**
 * One application's form, followed while its session lasts. The page in
 * Chrome is the truth: the form is read off it after every step, page by
 * page, never taken on Claude's word. An answer the user sets on the app's
 * screen (or the chat sets for them) is kept as theirs: the app types it into
 * the page when the field is there, Claude is told to leave it or to go and
 * set it, and nothing is sent while the page holds anything else.
 */
export class LiveForm {
  private fields: Followed[] = []
  private url = ''
  private title = ''
  private page = 0
  private sent: string | null = null
  /** What the form held when the user approved sending it. */
  private approved: string | null = null
  /** Reads and writes take their turn in the tab. */
  private turn: Promise<unknown> = Promise.resolve()
  private pushed = ''

  constructor(
    private readonly chrome: PageDriver,
    private readonly hooks: LiveFormHooks,
  ) {}

  state(): ApplicationForm {
    const fields = [...this.fields].sort((a, b) => a.page - b.page || a.order - b.order).map(shown)
    return { url: this.url, title: this.title, page: this.page, fields, sent: this.sent }
  }

  /** Resolves once the app's own reading and typing in the tab is done. */
  idle(): Promise<void> {
    return this.turn.then(
      () => undefined,
      () => undefined,
    )
  }

  /** Reads the form off the page into what is kept. */
  read(): Promise<void> {
    return this.inTurn(async () => {
      if (this.sent) return
      const seen = await this.look()
      if (seen) this.take(seen)
    })
  }

  /**
   * Types the user's answers into the fields the page shows, then reads the
   * form again to see what it kept. A field the page changed to something of
   * its own, such as a suggestion picked for a city, keeps that.
   */
  write(): Promise<void> {
    return this.inTurn(async () => {
      if (this.sent) return
      const before = new Map<string, string>()
      for (const field of this.fields) {
        if (!this.canSet(field)) continue
        before.set(field.key, field.value)
        try {
          const found = await this.chrome.evaluate<{ ref?: number; error?: string }>(fieldRefScript(field.key, field.wanted!), true)
          if (found.ref === undefined) continue
          await setField({ chrome: this.chrome }, found.ref, field.kind === 'checkbox' ? (field.wanted === 'Yes' ? 'checked' : 'unchecked') : field.wanted!)
        } catch {
          // The reading below shows it did not take; after a second try it goes to Claude.
        }
      }
      if (before.size) await sleep(300)
      const seen = await this.look()
      if (seen) this.take(seen, before)
    })
  }

  /** Brings the page in line with the user's answers as far as the app can itself, and reads it. */
  async settle(): Promise<void> {
    for (let i = 0; i <= MAX_TRIES; i++) {
      await this.write()
      if (!this.fields.some(field => this.canSet(field))) return
    }
  }

  /** After each of Claude's steps: the form is read again, and Claude hears of answers the user changed. */
  async afterStep(): Promise<string | null> {
    if (this.hooks.canWrite()) await this.settle()
    else await this.read()
    return this.note()
  }

  /**
   * Sets an answer at the user's word, or the chat's. It is typed into the
   * page at once when the field is there and Claude is not mid-step; otherwise
   * after the step, or by Claude. Null drops their answer: what the page holds stands.
   */
  async set(key: string, value: string | null, by: 'you' | 'chat'): Promise<FormField> {
    if (this.sent) throw new Error('That application was already sent.')
    const field = this.fields.find(one => one.key === key)
    if (!field) throw new Error('That field is no longer on the form.')
    let next = value
    if (next !== null) {
      if (field.isReadOnly) throw new Error(`The form won't let "${field.label}" be changed.`)
      if (field.kind === 'file') throw new Error('A file is changed in Chrome, not here.')
      if (field.kind === 'checkbox') next = /^(yes|true|checked|check|on|tick)$/i.test(next.trim()) ? 'Yes' : 'No'
      if (field.options) {
        const option = field.options.find(one => sameAnswer(field, one, next!))
        if (!option) throw new Error(`"${field.label}" takes one of: ${field.options.join(' | ')}`)
        next = option
      }
      field.by = by
    }
    field.wanted = next
    field.wantedBy = next === null ? null : by
    field.asked = null
    field.sentBack = null
    field.told = null
    field.tries = 0
    field.isStuck = false
    this.push()
    if (this.hooks.canWrite()) await this.settle()
    return shown(field)
  }

  /** The fields a list of Claude's element numbers belong to, read fresh; null for a number that is no field. */
  async fieldsOf(refs: number[]): Promise<(FormField | null)[]> {
    await this.read()
    const keys = await this.keysOf(refs)
    return keys.map(key => this.fields.find(field => field.key === key)).map(field => (field ? shown(field) : null))
  }

  /** Marks the fields behind these element numbers as written answers: free text in the user's voice. */
  async markWritten(refs: number[]): Promise<void> {
    await this.read()
    const keys = new Set(await this.keysOf(refs))
    for (const field of this.fields) if (keys.has(field.key)) field.isWritten = true
    this.push()
  }

  /**
   * The user's answers the page still lacks, as lines for Claude to go and
   * set, each sent back once; null when there is none left to send back. One
   * Claude was already sent back for and could not set is marked stuck, for
   * the user to settle.
   */
  sendBack(): string | null {
    const lacking = this.fields.filter(isPending)
    const fresh = lacking.filter(field => field.sentBack !== field.wanted)
    for (const field of lacking) if (field.sentBack === field.wanted) field.isStuck = true
    for (const field of fresh) field.sentBack = field.asked = field.wanted
    this.push()
    if (fresh.length === 0) return null
    return [
      'The user changed these answers in the app, and the page does not hold them:',
      ...fresh.map(field => `${line(field, field.wanted!)}${field.value ? `, where the form has "${field.value}"` : ''}`),
      "Set each one, using the form's own Back or Edit to reach a field on an earlier page. Change nothing else.",
    ].join('\n')
  }

  /** Whether the form still holds exactly what the user approved, with nothing of theirs left to set. */
  isApproved(): boolean {
    return this.approved !== null && !this.fields.some(isPending) && this.approved === this.signature()
  }

  /** The user approved sending the form as it stands, their own answers included. */
  approve(): void {
    this.approved = this.signature()
  }

  /** The application went out: the form stays as it was sent, whatever the page shows next. */
  freeze(): ApplicationForm {
    this.sent ??= new Date().toISOString()
    this.push()
    return this.state()
  }

  /**
   * A send is asked for again, so the last one did not go through after all:
   * the form is followed again, and what changed on the page since counts.
   */
  reopen(): void {
    if (!this.sent) return
    this.sent = null
    this.push()
  }

  /* ---------------------------------------------------------------- inside */

  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const next = this.turn.then(work, work)
    this.turn = next.catch(() => undefined)
    return next
  }

  private look(): Promise<PageForm | null> {
    return this.chrome.evaluate<PageForm | null>(FORM_SCRIPT, true).catch(() => null)
  }

  private async keysOf(refs: number[]): Promise<string[]> {
    if (refs.length === 0) return []
    return this.chrome.evaluate<string[]>(fieldKeysScript(refs), true).catch(() => [])
  }

  /** An answer of the user's that the app can still type into the page itself. */
  private canSet(field: Followed): boolean {
    return isPending(field) && field.isOnPage && !field.isReadOnly && field.kind !== 'file' && field.tries < MAX_TRIES
  }

  private signature(): string {
    return JSON.stringify(this.fields.map(field => [field.key, answerOf(field).replace(/\s+/g, ' ').trim()]).sort())
  }

  /**
   * Takes a reading of the page into what is kept. `wrote` names the fields
   * the app just typed into, with what each held before.
   */
  private take(seen: PageForm, wrote?: Map<string, string>): void {
    // Another site is another form.
    if (this.fields.length && originOf(seen.url) !== originOf(this.url)) {
      this.fields = []
      this.page = 0
      this.approved = null
    }
    this.url = seen.url
    this.title = seen.title
    const kept = new Map(this.fields.map(field => [field.key, field]))
    const here = new Map(seen.fields.map((field, order) => [field.key, { ...field, order }]))
    const isUsersTurn = this.hooks.isUsersTurn()

    for (const field of this.fields) {
      const now = here.get(field.key)
      field.isOnPage = !!now
      if (!now) continue
      const typed = wrote?.get(field.key)
      if (typed !== undefined && field.wanted !== null) {
        // The app's own typing: the page kept it, turned it into something of its own, or refused it.
        if (sameAnswer(now, field.wanted, now.value)) field.tries = 0
        else if (now.value !== typed && now.value.trim()) field.wanted = now.value
        else field.tries++
      } else if (now.value !== field.value && !(field.wanted !== null && sameAnswer(now, field.wanted, now.value))) {
        // Someone else changed it. While the session waits on the user it was them, in Chrome, and what they chose there stands.
        field.by = isUsersTurn ? 'you' : 'claude'
        if (isUsersTurn && field.wanted !== null) {
          field.wanted = null
          field.wantedBy = null
        }
      }
      Object.assign(field, { label: now.label, kind: now.kind, options: now.options, isRequired: now.isRequired, isReadOnly: now.isReadOnly, value: now.value, order: now.order })
      if (!isPending(field)) {
        field.isStuck = false
        if (field.wantedBy) field.by = field.wantedBy
      }
    }

    if (seen.fields.length) {
      // Mostly fields seen before: the page most of them were on. Mostly new ones: the next page.
      const known = seen.fields.map(field => kept.get(field.key)).filter((field): field is Followed => !!field)
      const counts = new Map<number, number>()
      for (const field of known) counts.set(field.page, (counts.get(field.page) ?? 0) + 1)
      const usual = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0]
      const page = usual !== undefined && known.length * 2 >= seen.fields.length ? usual : Math.max(0, ...this.fields.map(field => field.page)) + 1
      this.page = page
      for (const now of here.values()) {
        if (kept.has(now.key)) continue
        this.fields.push({ ...now, page, wanted: null, by: 'site', isWritten: false, isOnPage: true, isStuck: false, group: seen.group, wantedBy: null, asked: null, sentBack: null, told: null, tries: 0 })
      }
      // A dialog that came and went with nothing set in it, such as a cookie notice, was never part of the application.
      const used = new Set(this.fields.filter(field => field.by !== 'site' || field.wanted !== null).map(field => field.group))
      this.fields = this.fields.filter(field => field.isOnPage || field.group === seen.group || used.has(field.group))
    }
    this.push()
  }

  /**
   * What Claude must hear about the user's answers, each once: the ones the
   * page now holds, to leave alone, and the ones only Claude can set.
   */
  private note(): string | null {
    const held = this.fields.filter(field => field.wanted !== null && !isPending(field) && field.told !== field.wanted)
    const todo = this.fields.filter(field => isPending(field) && !this.canSet(field) && field.asked !== field.wanted)
    if (held.length === 0 && todo.length === 0) return null
    for (const field of held) field.told = field.wanted
    for (const field of todo) field.asked = field.wanted
    return [
      '[From the app] The user changed answers on the form in the app. Theirs stand: never change one back.',
      ...(held.length ? ['Already on the page. Leave them exactly as they are:', ...held.map(field => line(field, field.wanted!))] : []),
      ...(todo.length
        ? ["Not on the page yet. Set each before going on, using the form's own Back or Edit to reach a field on an earlier page:", ...todo.map(field => line(field, field.wanted!))]
        : []),
    ].join('\n')
  }

  private push(): void {
    const form = this.state()
    const text = JSON.stringify(form)
    if (text === this.pushed) return
    this.pushed = text
    this.hooks.onChange(form)
  }
}
