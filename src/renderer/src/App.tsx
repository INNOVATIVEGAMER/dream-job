import { useEffect, useState } from 'react'
import type { FormEvent, JSX } from 'react'

import type {
  BrowserInfo,
  BrowserState,
  ChromeMode,
  ClaudeState,
  ClaudeStatus,
  FlowState,
  FlowStatus,
  Handover,
  PendingApproval,
} from '../../shared/types'

const FLOW_START: FlowState = {
  name: null,
  status: 'idle',
  model: null,
  log: [],
  postings: [],
  note: null,
  stats: null,
  approval: null,
  handover: null,
}

/** A run paused for the user: what to do in Chrome, then Resume. */
function HandoverCard({ handover }: { handover: Handover }): JSX.Element {
  return (
    <section className="card approval">
      <h2>Claude handed over to you</h2>
      <p className="handover-reason">{handover.reason}</p>
      <p className="muted">Do this in the Chrome window. Claude waits until you press Resume.</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => void window.jobApp.resume(handover.id)}>
          Resume
        </button>
        <button type="button" onClick={() => void window.jobApp.stopFlow()}>
          Stop the run
        </button>
      </div>
    </section>
  )
}

/**
 * A submit held for the user: each written answer in an editable field.
 * Approve sends exactly what the fields hold; Cancel sends nothing.
 */
function ApprovalCard({ approval }: { approval: PendingApproval }): JSX.Element {
  const [texts, setTexts] = useState(approval.answers.map(answer => answer.text))
  const isEmpty = texts.some(text => text.trim() === '')

  return (
    <section className="card approval">
      <h2>Approve before submitting</h2>
      <p className="muted small">
        {approval.title || 'A form'}
        {approval.url ? `, ${approval.url}` : ''}
      </p>
      <p className="muted">Nothing is sent until you approve. Edit any answer first if you like.</p>
      {approval.answers.map((answer, i) => (
        <label key={`${answer.ref}-${i}`} className="answer">
          <span>{answer.label}</span>
          <textarea
            rows={4}
            value={texts[i] ?? ''}
            onChange={event => setTexts(current => current.map((text, j) => (j === i ? event.target.value : text)))}
          />
        </label>
      ))}
      <div className="row">
        <button type="button" className="primary" disabled={isEmpty} onClick={() => void window.jobApp.approve(approval.id, texts)}>
          Approve and submit
        </button>
        <button type="button" onClick={() => void window.jobApp.cancelApproval(approval.id)}>
          Cancel
        </button>
      </div>
    </section>
  )
}

const FLOW_TEXT: Record<FlowStatus, string> = {
  idle: 'Not run yet.',
  running: 'Running...',
  done: 'Done.',
  failed: 'Failed.',
  stopped: 'Stopped.',
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const CLAUDE_START: ClaudeStatus = { state: 'checking', message: 'Checking Claude Code...', path: null, version: null, account: null }

/** How each verdict reads at a glance: a short label and its color. */
const CLAUDE_LABEL: Record<ClaudeState, { text: string; tone: 'good' | 'bad' | 'muted' }> = {
  checking: { text: 'Checking', tone: 'muted' },
  ok: { text: 'Ready', tone: 'good' },
  'signed-out': { text: 'Not signed in', tone: 'bad' },
  'api-key': { text: 'API key in use', tone: 'bad' },
  'other-provider': { text: 'Other provider', tone: 'bad' },
  missing: { text: 'Not installed', tone: 'bad' },
  error: { text: 'Check failed', tone: 'bad' },
}

const CLOSED: BrowserState = {
  mode: 'closed',
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  error: null,
}

const MODE_TEXT: Record<ChromeMode, string> = {
  closed: 'Chrome is closed.',
  signin: 'Chrome is open for signing in. The app is not connected to it.',
  controlled: 'Chrome is open and the app controls it.',
}

export function App(): JSX.Element {
  const [state, setState] = useState<BrowserState>(CLOSED)
  const [info, setInfo] = useState<BrowserInfo | null>(null)
  const [address, setAddress] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [claude, setClaude] = useState<ClaudeStatus>(CLAUDE_START)

  useEffect(() => {
    const stop = window.jobApp.onState(setState)
    void window.jobApp.requestState()
    void window.jobApp.info().then(setInfo)
    return stop
  }, [])

  useEffect(() => {
    const stop = window.jobApp.onClaudeStatus(setClaude)
    void window.jobApp.checkClaude()
    return stop
  }, [])

  const [flow, setFlow] = useState<FlowState>(FLOW_START)
  const [huntUrl, setHuntUrl] = useState('')

  useEffect(() => {
    const stop = window.jobApp.onFlow(setFlow)
    void window.jobApp.requestFlow()
    return stop
  }, [])

  const isRunning = flow.status === 'running'

  const runHunt = (event: FormEvent): void => {
    event.preventDefault()
    void window.jobApp.runHunt(huntUrl)
  }

  const label = CLAUDE_LABEL[claude.state]

  useEffect(() => {
    if (!isEditing) setAddress(state.url)
  }, [state.url, isEditing])

  const isOpen = state.mode !== 'closed'
  const isControlled = state.mode === 'controlled'

  const go = (event: FormEvent): void => {
    event.preventDefault()
    setIsEditing(false)
    void window.jobApp.navigate(address)
  }

  return (
    <main className="panel">
      <header className="panel-head">
        <h1>Job App</h1>
        <p className="muted">POC step 6: the tracker</p>
        <div className="row head-actions">
          <button type="button" className="primary" onClick={() => void window.jobApp.openTracker()}>
            Open tracker
          </button>
        </div>
      </header>

      {flow.handover && <HandoverCard key={flow.handover.id} handover={flow.handover} />}
      {flow.approval && <ApprovalCard key={flow.approval.id} approval={flow.approval} />}

      <section className="card claude">
        <div className="claude-head">
          <h2>Claude</h2>
          <span className={`badge badge-${label.tone}`}>{label.text}</span>
        </div>
        <p className="claude-message">{claude.message}</p>
        {claude.account && (
          <dl className="facts">
            {claude.account.email && (
              <>
                <dt>Account</dt>
                <dd>{claude.account.email}</dd>
              </>
            )}
            {claude.account.subscriptionType && (
              <>
                <dt>Plan</dt>
                <dd>{claude.account.subscriptionType}</dd>
              </>
            )}
            {claude.account.tokenSource && (
              <>
                <dt>Signed in through</dt>
                <dd>{claude.account.tokenSource}</dd>
              </>
            )}
            <dt>API key</dt>
            <dd>{claude.account.apiKeySource ?? 'none'}</dd>
          </dl>
        )}
        {claude.path && (
          <p className="muted small">
            {claude.path}
            {claude.version ? `, version ${claude.version}` : ''}
          </p>
        )}
        <div className="row">
          <button type="button" onClick={() => void window.jobApp.checkClaude()} disabled={claude.state === 'checking'}>
            Check again
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Chrome</h2>
        <p className={`mode mode-${state.mode}`}>{MODE_TEXT[state.mode]}</p>
        <div className="row">
          <button type="button" className="primary" onClick={() => void window.jobApp.openChrome('controlled')} disabled={isOpen}>
            Open Chrome
          </button>
          <button type="button" onClick={() => void window.jobApp.openChrome('signin')} disabled={isOpen}>
            Open to sign in
          </button>
          <button type="button" onClick={() => void window.jobApp.closeChrome()} disabled={!isOpen}>
            Close Chrome
          </button>
        </div>
        {state.error && <p className="error">{state.error}</p>}
        {info && <p className="muted small">Profile: {info.profileDir}</p>}
      </section>

      <section className="card">
        <h2>Page</h2>
        <div className="row">
          <button type="button" onClick={() => void window.jobApp.back()} disabled={!isControlled || !state.canGoBack}>
            Back
          </button>
          <button type="button" onClick={() => void window.jobApp.forward()} disabled={!isControlled || !state.canGoForward}>
            Forward
          </button>
          <button type="button" onClick={() => void window.jobApp.reload()} disabled={!isControlled}>
            Reload
          </button>
        </div>
        <form className="address" onSubmit={go}>
          <input
            aria-label="Address"
            value={address}
            disabled={!isControlled}
            onFocus={() => setIsEditing(true)}
            onBlur={() => setIsEditing(false)}
            onChange={event => setAddress(event.target.value)}
            spellCheck={false}
          />
          <button type="submit" className="primary" disabled={!isControlled}>
            Go
          </button>
        </form>
        <p className="page-title">{isControlled ? state.title || 'No title yet' : 'Open Chrome to follow its page here.'}</p>
      </section>

      <section className="card">
        <h2>Mini hunt</h2>
        <p className="muted">
          Paste a LinkedIn jobs search URL. Claude opens it in the app's Chrome, reads the first page, and lists up to 10
          postings. It only reads: nothing is clicked or sent.
        </p>
        <form className="address" onSubmit={runHunt}>
          <input
            aria-label="LinkedIn jobs search URL"
            placeholder="https://www.linkedin.com/jobs/search/?keywords=..."
            value={huntUrl}
            onChange={event => setHuntUrl(event.target.value)}
            disabled={isRunning}
            spellCheck={false}
          />
          {isRunning ? (
            <button type="button" onClick={() => void window.jobApp.stopFlow()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!isControlled || huntUrl.trim() === ''}>
              Run
            </button>
          )}
        </form>
        {!isControlled && !isRunning && <p className="muted small">Open Chrome first: the hunt runs in the app's Chrome.</p>}
        <p className={`flow-status flow-${flow.status}`}>
          {flow.name ? `${flow.name}: ` : ''}
          {FLOW_TEXT[flow.status]}
          {flow.model ? ` Model ${flow.model}.` : ''}
        </p>
        {flow.stats && (
          <p className="muted small">
            {flow.stats.turns} turns, {flow.stats.inputTokens.toLocaleString()} input and{' '}
            {flow.stats.outputTokens.toLocaleString()} output tokens
            {flow.stats.cacheReadTokens > 0 ? ` (${flow.stats.cacheReadTokens.toLocaleString()} read from cache)` : ''},{' '}
            {seconds(flow.stats.durationMs)}
          </p>
        )}
        {flow.note && <p className="note">{flow.note}</p>}
        {flow.postings.length > 0 && (
          <ol className="postings">
            {flow.postings.map(posting => (
              <li key={posting.link || `${posting.company}-${posting.title}`}>
                <button type="button" className="link" onClick={() => void window.jobApp.navigate(posting.link)} disabled={!isControlled}>
                  {posting.title}
                </button>
                <span className="muted small">
                  {posting.company}, {posting.location}, {posting.posted}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card">
        <h2>Form test</h2>
        <p className="muted">
          Claude fills httpbin's public test form with made-up details and writes a short Delivery instructions answer.
          Before anything is sent, the answer appears in a card at the top for you to edit, approve or cancel.
        </p>
        <div className="row">
          <button type="button" className="primary" onClick={() => void window.jobApp.runFormTest()} disabled={!isControlled || isRunning}>
            Run form test
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Hand-over test</h2>
        <p className="muted">
          Claude opens Google's reCAPTCHA demo page and, instead of touching the CAPTCHA, hands it to you. Complete it in
          Chrome, press the page's Submit, then Resume here. Claude reads the page and says whether it worked.
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => void window.jobApp.runHandoverTest()}
            disabled={!isControlled || isRunning}
          >
            Run hand-over test
          </button>
        </div>
      </section>

      {flow.log.length > 0 && (
        <section className="card">
          <h2>Activity</h2>
          <ol className="log">
            {flow.log.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className={`log-${entry.kind}`}>
                <span className="log-time">{clock(entry.at)}</span> {entry.text}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  )
}
