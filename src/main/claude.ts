import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import type { ClaudeStatus } from '../shared/types'

const run = promisify(execFile)

const CHECK_TIMEOUT_MS = 45_000

/**
 * Finds the user's own `claude`: on PATH first, then where the installer puts
 * it. The app never uses a copy of its own, so the sign-in is the user's.
 */
/** Where installers put command-line tools: an app opened from Finder gets none of these on its PATH. */
const toolDirs = (): string[] => {
  const home = homedir()
  return [join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']
}

export async function findClaude(): Promise<string | null> {
  const dirs = [...(process.env['PATH'] ?? '').split(delimiter), ...toolDirs()]
  for (const dir of dirs) {
    if (!dir) continue
    const path = join(dir, 'claude')
    try {
      await access(path, constants.X_OK)
      return path
    } catch {
      // not here; try the next place
    }
  }

  return null
}

/**
 * The environment Claude Code runs in: the app's own, minus every API
 * credential, so its usage can only bill the user's Claude plan. The SDK's
 * `env` replaces the whole environment, so PATH and HOME come along.
 */
export function claudeEnv(): Record<string, string | undefined> {
  const path = [...new Set([...(process.env['PATH'] ?? '').split(delimiter), ...toolDirs(), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean))]
  const env: Record<string, string | undefined> = { ...process.env, PATH: path.join(delimiter), CLAUDE_AGENT_SDK_CLIENT_APP: 'job-app/0.1.0' }
  delete env['ANTHROPIC_API_KEY']
  delete env['ANTHROPIC_AUTH_TOKEN']

  return env
}

/** A prompt that never sends a message: Claude Code starts and answers questions, and no model request is made. */
async function* noMessages(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
}

function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms)
    work.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const isSet = (value: string | undefined): value is string => Boolean(value) && value !== 'none'

/** Reads the verdict from what Claude Code says about the account. */
export function judge(account: AccountInfo): Pick<ClaudeStatus, 'state' | 'message'> {
  if (account.apiProvider && account.apiProvider !== 'firstParty') {
    return {
      state: 'other-provider',
      message: `Claude Code is set up for ${account.apiProvider}, not your Claude subscription. Run claude auth login to sign in with your Claude account.`,
    }
  }
  if (isSet(account.apiKeySource)) {
    return {
      state: 'api-key',
      message: `Claude Code is signed in with an API key (${account.apiKeySource}), which would bill the API. Sign in with your Claude account instead: claude auth login.`,
    }
  }
  // A signed-in account reports an email or a plan; `tokenSource` is often
  // left out entirely, so its absence alone does not mean signed out.
  const isSignedIn = isSet(account.tokenSource) || Boolean(account.subscriptionType) || Boolean(account.email)
  if (isSignedIn) {
    const plan = account.subscriptionType ? `the ${account.subscriptionType} plan` : 'your Claude subscription'
    return { state: 'ok', message: `Signed in${account.email ? ` as ${account.email}` : ''} on ${plan}.` }
  }

  return { state: 'signed-out', message: 'Claude Code is not signed in. Run claude auth login in a terminal, then check again.' }
}

/**
 * The setup check: finds the user's `claude`, starts it through the Agent
 * SDK with no tools, no settings and no message, asks who is signed in, and
 * closes it. Costs no usage.
 */
export async function checkClaude(cwd: string): Promise<ClaudeStatus> {
  const path = await findClaude()
  if (!path) {
    return {
      state: 'missing',
      message: 'Claude Code was not found. Install it, sign in with claude auth login, then check again.',
      path: null,
      version: null,
      account: null,
    }
  }

  let version: string | null = null
  try {
    const { stdout } = await run(path, ['--version'], { timeout: 15_000, env: claudeEnv() })
    version = stdout.trim().split(' ')[0] ?? null
  } catch {
    // the version is shown when known; the account check below decides
  }

  const stop = new AbortController()
  const session = query({
    prompt: noMessages(stop.signal),
    options: {
      pathToClaudeCodeExecutable: path,
      cwd,
      env: claudeEnv(),
      settingSources: [],
      tools: [],
      persistSession: false,
    },
  })
  try {
    const account = await within(session.accountInfo(), CHECK_TIMEOUT_MS, 'Starting Claude Code')

    return { ...judge(account), path, version, account: { ...account } }
  } catch (error) {
    return {
      state: 'error',
      message: `The check could not finish: ${error instanceof Error ? error.message : String(error)}`,
      path,
      version,
      account: null,
    }
  } finally {
    stop.abort()
    session.close()
  }
}
