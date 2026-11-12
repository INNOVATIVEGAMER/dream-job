import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { ChromeController } from './chrome'

export const BROWSER_SERVER = 'browser'

/** The tools that run without asking, by the full names Claude Code knows them by, for `allowedTools`. */
export const BROWSER_TOOLS = ['open_page', 'read_page', 'click', 'type_text', 'hand_to_user'].map(
  name => `mcp__${BROWSER_SERVER}__${name}`,
)

/** Pauses the run until the user resumes it, or answers `stopped` when the run is stopped instead. */
export type HandOver = (reason: string) => Promise<'resumed' | 'stopped'>

/** The one tool that sends something. It is never pre-approved: the user approves each call. */
export const SUBMIT_TOOL = `mcp__${BROWSER_SERVER}__submit`

/** What `submit` takes: the submit control, and each written answer with its field. */
export const SubmitInput = z.object({
  ref: z.number().int().positive().describe('The number of the submit button from read_page'),
  answers: z
    .array(
      z.object({
        ref: z.number().int().positive().describe('The number of the text field from read_page'),
        label: z.string().describe('The question as the form words it'),
        text: z.string().describe('The written answer'),
      }),
    )
    .min(1)
    .max(6),
})
export type SubmitInputValue = z.infer<typeof SubmitInput>

const MAX_TEXT = 15_000
const MAX_ELEMENTS = 150

/**
 * Reads the tab: its text, cut to a length, and a numbered list of what can
 * be clicked or typed into. Each listed element is tagged with its number, so
 * `click` and `type_text` find it again.
 */
const READ_SCRIPT = `(() => {
  const isShown = el => {
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  document.querySelectorAll('[data-jobapp-ref]').forEach(el => el.removeAttribute('data-jobapp-ref'))
  const found = [...document.querySelectorAll(
    'a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]'
  )].filter(isShown).slice(0, ${MAX_ELEMENTS})
  const elements = found.map((el, i) => {
    const ref = i + 1
    el.setAttribute('data-jobapp-ref', String(ref))
    const tag = el.tagName.toLowerCase()
    const type = el.getAttribute('type') || ''
    const named = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null
    const label = (el.getAttribute('aria-label') || (named && named.innerText) || el.innerText ||
      el.getAttribute('placeholder') || el.getAttribute('name') || el.value || el.getAttribute('title') || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 80)
    const href = tag === 'a' ? ' -> ' + el.href.slice(0, 200) : ''
    return '[' + ref + '] ' + tag + (type ? '(' + type + ')' : '') + ' "' + label + '"' + href
  })
  const all = (document.body && document.body.innerText) || ''
  return {
    url: location.href,
    title: document.title,
    text: all.replace(/\\n{3,}/g, '\\n\\n').slice(0, ${MAX_TEXT}),
    isCut: all.length > ${MAX_TEXT},
    elements,
  }
})()`

/** Finds element `ref`, refuses anything that submits, scrolls it into view, answers its centre. */
const clickScript = (ref: number): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]')
  if (!el) return { error: 'No element ${ref} on this page now. Read the page again.' }
  const words = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim()
  const isSubmitButton = el.tagName === 'BUTTON' && (el.getAttribute('type') || 'submit') === 'submit' && el.form
  const isSubmitInput = el.tagName === 'INPUT' && ['submit', 'image'].includes(el.type)
  if (isSubmitButton || isSubmitInput || /\\b(submit|apply|send|post)\\b/i.test(words)) {
    return { refused: 'Element ${ref} ("' + words.slice(0, 40) + '") would submit or send something. Clicking it is not allowed here.' }
  }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const box = el.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
})()`

/** Finds the submit control `ref` and answers its centre: only `submit` uses this, after approval. */
const pressScript = (ref: number): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]')
  if (!el) return { error: 'No element ${ref} on this page now. Read the page again.' }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const box = el.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
})()`

/** Focuses element `ref` and selects what it holds, so typing replaces it. */
const focusScript = (ref: number): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]')
  if (!el) return { error: 'No element ${ref} on this page now. Read the page again.' }
  const isField = el.tagName === 'TEXTAREA' || el.isContentEditable ||
    (el.tagName === 'INPUT' && !['submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'hidden'].includes(el.type))
  if (!isField) return { error: 'Element ${ref} is not a text field.' }
  el.scrollIntoView({ block: 'center' })
  el.focus()
  if (typeof el.select === 'function') el.select()
  else document.execCommand('selectAll')
  return { ok: true }
})()`

type ReadResult = { url: string; title: string; text: string; isCut: boolean; elements: string[] }
type Point = { x?: number; y?: number; error?: string; refused?: string }

const say = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const refuse = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

async function guarded(work: () => Promise<ReturnType<typeof say>>): Promise<ReturnType<typeof say>> {
  try {
    return await work()
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error))
  }
}

/**
 * The browser tools Claude gets: the only way it can act. They drive the tab
 * the app follows in its own Chrome, with real mouse and keyboard input.
 */
export function browserServer(chrome: ChromeController, handOver: HandOver): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: BROWSER_SERVER,
    version: '0.1.0',
    tools: [
      tool(
        'open_page',
        'Open a URL in the Chrome tab and wait for it to load.',
        { url: z.string().describe('The full https URL to open') },
        ({ url }) =>
          guarded(async () => {
            await chrome.openPage(url)
            const page = await chrome.evaluate<{ url: string; title: string }>('({ url: location.href, title: document.title })')
            return say(`Opened ${page.url}\nTitle: ${page.title}\nCall read_page to see what it shows.`)
          }),
      ),
      tool(
        'read_page',
        'Read the Chrome tab: its URL, title, text, and a numbered list of the links, buttons and fields on it. Use the numbers with click and type_text. Read again after the page changes, since the numbers change too.',
        {},
        () =>
          guarded(async () => {
            const page = await chrome.evaluate<ReadResult>(READ_SCRIPT)
            return say(
              [
                `URL: ${page.url}`,
                `Title: ${page.title}`,
                '',
                'Text:',
                page.text + (page.isCut ? '\n[text cut here]' : ''),
                '',
                'Elements:',
                ...page.elements,
              ].join('\n'),
            )
          }),
      ),
      tool(
        'click',
        'Click element n from the last read_page. Anything that would submit, apply, send or post is refused.',
        { ref: z.number().int().positive().describe('The element number from read_page') },
        ({ ref }) =>
          guarded(async () => {
            const point = await chrome.evaluate<Point>(clickScript(ref))
            if (point.error) return refuse(point.error)
            if (point.refused) return refuse(point.refused)
            if (point.x === undefined || point.y === undefined) return refuse('The element has no position on screen.')
            await chrome.clickAt(point.x, point.y)
            return say(`Clicked element ${ref}. Read the page again to see the result.`)
          }),
      ),
      tool(
        'type_text',
        'Type text into text field n from the last read_page, replacing what it holds, as real keyboard input.',
        {
          ref: z.number().int().positive().describe('The element number from read_page'),
          text: z.string().describe('What to type'),
        },
        ({ ref, text }) =>
          guarded(async () => {
            const focus = await chrome.evaluate<{ ok?: boolean; error?: string }>(focusScript(ref))
            if (focus.error) return refuse(focus.error)
            await chrome.insertText(text)
            return say(`Typed into element ${ref}.`)
          }),
      ),
      tool(
        'hand_to_user',
        'Pause and hand the Chrome window to the user for something only they may do: a sign-in, a CAPTCHA, a one-time code, a check of their identity. Say in one sentence what they need to do. Returns when they say they are done; read the page again then, since it will have changed.',
        { reason: z.string().describe('What the user needs to do, in one sentence') },
        ({ reason }) =>
          guarded(async () => {
            // A tool call has no time limit by default, so this waits as long as the user needs.
            await chrome.command('Page.bringToFront').catch(() => undefined)
            const outcome = await handOver(reason)
            if (outcome === 'stopped') return refuse('The user stopped the run. Finish now without doing anything more.')
            return say('The user says they are done. Read the page again before going on.')
          }),
      ),
      tool(
        'submit',
        'Submit a form. Give the number of its submit button and every free-text answer you wrote: the field number, the question as the form words it, and the text. The user sees the answers first and may edit them. If they approve, each field is set to the approved text and the button is pressed. If they cancel, nothing is sent and this call is refused.',
        SubmitInput.shape,
        ({ ref, answers }) =>
          guarded(async () => {
            // Runs only after the user approved; `answers` holds the text they approved.
            for (const answer of answers) {
              const focus = await chrome.evaluate<{ ok?: boolean; error?: string }>(focusScript(answer.ref))
              if (focus.error) return refuse(`Nothing was submitted: ${focus.error}`)
              await chrome.insertText(answer.text)
            }
            const point = await chrome.evaluate<Point>(pressScript(ref))
            if (point.error) return refuse(`Nothing was submitted: ${point.error}`)
            if (point.x === undefined || point.y === undefined) return refuse('Nothing was submitted: the button has no position.')
            await chrome.clickAt(point.x, point.y)
            await chrome.settle()
            const page = await chrome.evaluate<{ url: string; title: string }>('({ url: location.href, title: document.title })')
            return say(`Submitted with the approved text. Now at ${page.url} (${page.title}). Read the page to see the response.`)
          }),
      ),
    ],
  })
}
