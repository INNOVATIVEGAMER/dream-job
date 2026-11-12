# job-app

A local Electron app for the job search: a tracker, flows started from
buttons, and a built-in browser, with Claude driven through the Agent SDK on
the user's own Claude subscription. Private, personal, used daily; no public
release.

Scope doc (the POC's checks and build order):
https://claude.ai/artifact/2jzHoWNXxeDz7JwwYnEHAm

## This repo is the whole product

- **Never read, write or change `~/Desktop/job`.** That is the original job
  system and stays exactly as it is. The app does not sync with it or import
  from it.
- `data/job.db` holds the opportunities. It started from a one-time copy of 96
  rows kept from an earlier POC, never from the job folder.
- A Claude Code mod was tried first and rejected (the approval flow failed,
  every flow ran through the chat). Do not suggest mods or plugins.

## AI

- Claude runs through `@anthropic-ai/claude-agent-sdk`, pointed at the user's
  installed, signed-in `claude`. Never an API key: remove `ANTHROPIC_API_KEY`
  from the environment Claude Code runs in.
- `src/main/claude.ts` finds the user's `claude` (PATH, then `~/.local/bin`
  and the other install places) and runs the setup check: `query()` with a
  prompt that never yields, `tools: []`, `settingSources: []`,
  `persistSession: false`, cwd in the app's data folder, then
  `accountInfo()` and `close()`. No model request, no usage.
- `accountInfo()` on a signed-in subscription returns `email`,
  `subscriptionType` (for example "Claude Ultra") and `apiProvider:
  "firstParty"`, and often no `tokenSource`: never treat a missing
  `tokenSource` as signed out.
- The SDK (0.3.322, matching CLI 2.1.322) is ES-module only; the CommonJS main
  process `require`s it because Electron 45 runs Node 24. Keep it external, not
  bundled.
- Flows run in the background and show results on screens, not in a chat.
- `src/main/flows.ts` runs one flow at a time: `tools: []`, the browser tools
  from `src/main/browser-tools.ts` as an in-process MCP server, `allowedTools`
  plus `permissionMode: 'dontAsk'` so nothing else can run, streaming input
  (needed for `interrupt()`), and `outputFormat` built from the same Zod schema
  the app checks the answer with. The SDK adds its own `StructuredOutput` tool
  to collect that answer.
- Browser tools: `open_page`, `read_page` (text plus numbered elements, tagged
  `data-jobapp-ref`), `click` (real mouse events; refuses submit, apply, send,
  post), `type_text` (real keyboard input), `submit` (gated, below) and
  `hand_to_user` (pauses the run on a card until the user presses Resume; a
  tool call has no time limit by default, so it waits as long as needed).
- Claude hands over for any sign-in, CAPTCHA, one-time code or identity check,
  and never types a password or code or solves a CAPTCHA itself. A Google
  sign-in cannot be done under the app's control (see above), so a flow that
  meets one ends with the user stopping it and signing in through "Open to
  sign in".
- **The approval gate**: the four tools above are in `allowedTools`; `submit`
  is not, so with `permissionMode: 'default'` every call reaches `canUseTool`,
  which shows the card and waits with no time limit. Approve returns
  `updatedInput` with the user's text, and the tool re-types it before
  pressing the button. Cancel denies the call. Anything else that reaches the
  callback is refused, except the SDK's `StructuredOutput`. The SDK's
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning about the pre-approved tools is
  expected.
- The form test checks what httpbin received from the response page itself,
  not from Claude's report.
- Known gap for the real hunt: LinkedIn's results page has job cards without
  links, so `read_page` sees only the first posting's id. Read the job ids the
  cards carry before building the real hunt.
- The tracker: `src/main/tracker.ts` reads and writes `data/job.db` (in the
  repo, via `app.getAppPath()`) through Node's built-in `node:sqlite`, which
  Electron 45's Node 24 includes: no native module to rebuild. Only the main
  process touches the file. The tracker has its own window (`#tracker` loads
  the same renderer as the tracker screen), 15 rows a page.
- Testing outside Electron: `pnpm exec tsx <file>.mts` runs the real
  `ChromeController` and `FlowRunner`; pass `['--headless=new']` as the
  controller's extra args and a throwaway profile dir.
- Usage: `input_tokens` counts only uncached input, often single digits. Total
  input is it plus `cache_creation_input_tokens` and `cache_read_input_tokens`.
- With `settingSources: []` and no `model`, runs use `claude-opus-5-5`.
- Approval holds the submit itself (the SDK's permission callback can wait as
  long as the user needs), rather than relying on Claude to stop.

## Running

- `pnpm install`, then the user runs `pnpm dev` themselves. Never start the dev
  server or any long-running process from a session.
- `pnpm typecheck` and `pnpm build` are one-off checks and fine to run.
- Electron 45 downloads its binary on first run; after a fresh install run
  `node node_modules/electron/install.js` once.

## The browser is real Chrome

- **Google refuses sign-in inside an Electron browser**, even with a plain
  Chrome user agent and a Chrome brand list sent through the DevTools protocol.
  Both were tried. Do not go back to an embedded browser for signed-in sites.
- The app opens the installed Google Chrome with its own profile
  (`~/Library/Application Support/job-app/chrome-profile`, outside the repo so
  cookies never reach git), beside the app's window, in one of two modes:
  - `controlled`: `--remote-debugging-pipe`, a private pipe to the app only, no
    network port and no automation flags, so no banner and nothing a page can see
  - `signin`: no control link at all, for signing in to Google if Google
    refuses while the pipe is open
- `src/main/cdp.ts` is a small DevTools-protocol client over that pipe (NUL
  separated JSON); `src/main/chrome.ts` opens Chrome, follows one tab and
  drives it. Tested against Chrome 146: connect, follow a tab, navigate, history.
- Chrome on macOS keeps running after its last window closes; it counts as
  closed when quit (Cmd+Q) or when the app closes it.

## Layout

- `src/main`: the main process. The app's window, the Chrome controller, IPC.
- `src/preload`: the one bridge to the panel, `window.jobApp`.
- `src/renderer`: the React panel.
- `src/shared`: types both sides use.

- **Google refuses sign-in while the pipe is open**, but accepts it in
  `signin` mode. After that one-time sign-in, `controlled` mode works with the
  login in place, and it survives restarts. Any flow that meets a Google
  sign-in page hands over to the user, who signs in through "Open to sign in".
  Whether "Continue with Google" on other sites works under control once
  Google is signed in is not tested yet.

## Status

- Step 1 done: checks 3 and 8 pass, Google sign-in through `signin` mode.
- Step 2 done: check 1 passes, plan "Claude Ultra".
- Step 3 done: the mini hunt returned 10 postings from a real LinkedIn search
  (checks 4 and 7).
- Step 4 done: check 5 passes in the app (approve with an edit, and cancel).
- Step 5 built: `hand_to_user`, the hand-over card and the hand-over test on
  Google's reCAPTCHA demo (the plan's signed-out LinkedIn test cannot work,
  since Google sign-in is refused under control). Passed with the real code
  outside the app: paused 15 s, resumed unsolved, Claude never touched the
  CAPTCHA and reported it unsolved. Check 6 passes in the app.
- Step 6 done: check 9 passes in the app.
- **The POC is complete: all nine checks passed.** The write-up is at the top
  of the scope doc: results, numbers, findings, and a checklist of what to
  change before the real build (posting links, a page-level submit guard,
  smaller page reads, hunt results into the tracker, the real flows, Google
  sign-in on other sites, tests in the repo, packaging).
