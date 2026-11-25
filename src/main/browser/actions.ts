import type { PageDriver } from './chrome'
import { chooseScript, fieldScript, focusScript, pointScript, suggestionScript } from './page-scripts'
import type { FieldKind } from './page-scripts'

/** Whatever holds the tab to act in: a run's context, or the form the app follows. */
type InTab = { chrome: PageDriver }

type Point = { x?: number; y?: number; error?: string }

/** Clicks element `ref` at its centre, with no checks: for the app's own tools, after their own checks. */
export async function pressRef(ctx: InTab, ref: number): Promise<void> {
  const point = await ctx.chrome.evaluate<Point>(pointScript(ref))
  if (point.error) throw new Error(point.error)
  if (point.x === undefined || point.y === undefined) throw new Error('The element has no position on screen.')
  await ctx.chrome.clickAt(point.x, point.y)
}

/** Replaces what text field `ref` holds with `text`, as typing; no text empties it. */
export async function typeInto(ctx: InTab, ref: number, text: string): Promise<void> {
  const focus = await ctx.chrome.evaluate<{ ok?: boolean; error?: string }>(focusScript(ref))
  if (focus.error) throw new Error(focus.error)
  // What the field held is selected: typing replaces it, and Backspace clears it.
  if (text) await ctx.chrome.insertText(text)
  else await ctx.chrome.pressKey('Backspace')
}

/**
 * Sets field `ref` from the last read to `value`, the way a person would:
 * types into a text field (and picks the matching suggestion of a type-ahead),
 * chooses a select's option, and ticks or unticks a radio or checkbox, where
 * "yes", "true" or "checked" ticks it.
 */
export async function setField(ctx: InTab, ref: number, value: string): Promise<string> {
  const field = await ctx.chrome.evaluate<{ kind?: FieldKind; checked?: boolean; x?: number; y?: number; error?: string }>(fieldScript(ref))
  if (field.error || !field.kind) throw new Error(field.error ?? `No element ${ref}.`)
  switch (field.kind) {
    case 'text':
      await typeInto(ctx, ref, value)
      return `typed into ${ref}`
    case 'combobox': {
      await typeInto(ctx, ref, value)
      await new Promise(resolve => setTimeout(resolve, 900))
      const option = await ctx.chrome.evaluate<{ x?: number; y?: number; text?: string; none?: boolean }>(suggestionScript(value))
      if (option.none || option.x === undefined || option.y === undefined) return `typed into ${ref}; no suggestion showed`
      await ctx.chrome.clickAt(option.x, option.y)
      return `typed into ${ref} and picked "${option.text}"`
    }
    case 'select': {
      const result = await ctx.chrome.evaluate<{ chosen?: string; error?: string }>(chooseScript(ref, value))
      if (result.error) throw new Error(result.error)
      return `chose "${result.chosen}" in ${ref}`
    }
    case 'radio':
    case 'checkbox': {
      const want = field.kind === 'radio' || /^(yes|true|checked|check|on|tick)$/i.test(value.trim())
      if (field.checked === want) return `${ref} was already ${want ? 'ticked' : 'unticked'}`
      if (field.x === undefined || field.y === undefined) throw new Error(`Element ${ref} has no position on screen.`)
      await ctx.chrome.clickAt(field.x, field.y)
      return `${want ? 'ticked' : 'unticked'} ${ref}`
    }
    case 'file':
      throw new Error(`Element ${ref} is a file field: use upload_resume.`)
    default:
      throw new Error(`Element ${ref} is not a field. Read the page again and give a field's number.`)
  }
}
