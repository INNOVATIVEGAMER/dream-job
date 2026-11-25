import { createContext, useContext, useEffect, useState } from 'react'
import type { JSX } from 'react'

import { BrowserIcon, CaretDownIcon, CheckIcon, PaperPlaneTiltIcon, PlayIcon } from '@phosphor-icons/react'

import { isMissing, isPending } from '../../../../shared/form'
import { TOOL_SITE_NAMES } from '../../../../shared/types'
import type { ApplicationForm, CardAnswer, RunCard } from '../../../../shared/types'
import { api } from '../../lib/api'
import { plural } from '../../lib/format'
import { go } from '../../lib/router'
import { attempt, Numbers } from '../../ui/common'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListItem,
  DescriptionListTerm,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Kbd,
  KbdGroup,
  Switch,
  Textarea,
} from '../../ui/nx'
import { flushForm } from './Form'

/** Where a card's answer goes, and which Chrome tab it shows: a run's, or the chat's. */
export type CardActions = {
  answer: (card: RunCard, reply: CardAnswer) => Promise<void | undefined>
  showTab: (card: RunCard) => Promise<void | undefined>
}

const RUN_ACTIONS: CardActions = {
  answer: (card, reply) => attempt(() => api.runs.answer(card.id, reply)),
  /** Shows the tab of the session waiting on this card: its own tab when the run has several, else the one Chrome shows. */
  showTab: card => attempt(() => api.runs.showTab(card.id)),
}

const Actions = createContext<CardActions>(RUN_ACTIONS)

function Footer({ children, end }: { children: JSX.Element | JSX.Element[]; end?: JSX.Element }): JSX.Element {
  return (
    <CardFooter>
      <div className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-2 nx:w-full">
        <div className="nx:flex nx:flex-wrap nx:gap-2">{children}</div>
        {end}
      </div>
    </CardFooter>
  )
}

function ApproveCard({ card }: { card: Extract<RunCard, { kind: 'approve' }> }): JSX.Element {
  const { answer, showTab } = useContext(Actions)
  const [texts, setTexts] = useState(card.answers.map(one => one.text))
  useEffect(() => setTexts(card.answers.map(one => one.text)), [card.id])
  const submit = (): void => void answer(card, { kind: 'approve', texts })

  // Cmd+Enter submits, as the button says.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approve your answers</CardTitle>
        <CardDescription>{card.isMidForm ? 'Nothing is typed or sent until you approve.' : 'Nothing is sent until you submit.'}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {card.answers.map((one, i) => (
            <Field key={`${card.id}-${i}`}>
              <FieldLabel htmlFor={`answer-${i}`}>{one.label}</FieldLabel>
              <Textarea
                id={`answer-${i}`}
                rows={Math.min(10, Math.max(3, Math.ceil(one.text.length / 90)))}
                value={texts[i] ?? ''}
                onChange={event => setTexts(current => current.map((text, j) => (j === i ? event.target.value : text)))}
              />
            </Field>
          ))}
          {card.facts.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" endIcon={<CaretDownIcon />} className="nx:self-start nx:px-0">
                  {card.facts.length} {card.facts.length === 1 ? 'fact' : 'facts'} from your answers
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <DescriptionList>
                  {card.facts.map(fact => (
                    <DescriptionListItem key={fact.label}>
                      <DescriptionListTerm>{fact.label}</DescriptionListTerm>
                      <DescriptionListDescription>{fact.value}</DescriptionListDescription>
                    </DescriptionListItem>
                  ))}
                </DescriptionList>
              </CollapsibleContent>
            </Collapsible>
          )}
        </FieldGroup>
      </CardContent>
      <Footer
        end={
          <Button variant="ghost" startIcon={<BrowserIcon />} onClick={() => void showTab(card)}>
            See the form
          </Button>
        }
      >
        <Button startIcon={<PaperPlaneTiltIcon />} onClick={submit}>
          {card.isMidForm ? 'Approve and apply' : 'Submit application'}
          <KbdGroup className="nx:ml-1">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
        </Button>
        <Button variant="outline" onClick={() => void answer(card, { kind: 'cancel' })}>
          {card.isMidForm ? "Don't apply" : "Don't submit"}
        </Button>
      </Footer>
    </Card>
  )
}

/**
 * A filled application, held: the form itself is below the card, where every
 * answer can be changed. Submit sends it as it stands there.
 */
function ReviewCard({ card, form }: { card: Extract<RunCard, { kind: 'review' }>; form: ApplicationForm | null }): JSX.Element {
  const { answer, showTab } = useContext(Actions)
  const [isSending, setSending] = useState(false)
  const fields = form?.fields ?? []
  const written = fields.filter(field => field.isWritten).length
  const missing = fields.filter(isMissing).length
  const stuck = fields.filter(field => field.isStuck).length
  const later = fields.filter(field => isPending(field) && !field.isOnPage && !field.isStuck).length
  const canSubmit = !isSending && stuck === 0

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSending(true)
    // An answer still being typed goes to the form first.
    await flushForm()
    await answer(card, { kind: 'submit' })
    setSending(false)
  }

  // Cmd+Enter submits, as the button says.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const facts = [
    fields.length ? plural(fields.length, 'answer') : '',
    written ? `${written} written for you` : '',
    missing ? `${missing} required and empty` : '',
    later ? `${plural(later, 'change')} Claude sets first` : '',
  ].filter(Boolean)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review your application</CardTitle>
        <CardDescription>
          {card.note ?? (stuck ? `The form would not take ${plural(stuck, 'answer')} of yours. Change ${stuck === 1 ? 'it' : 'them'} below, or keep what the form has.` : 'Nothing is sent until you submit. Change any answer below.')}
        </CardDescription>
      </CardHeader>
      {facts.length > 0 && (
        <CardContent>
          <Numbers items={facts} />
        </CardContent>
      )}
      <Footer
        end={
          <Button variant="ghost" startIcon={<BrowserIcon />} onClick={() => void showTab(card)}>
            See it in Chrome
          </Button>
        }
      >
        <Button startIcon={<PaperPlaneTiltIcon />} disabled={!canSubmit} onClick={() => void submit()}>
          {card.sends}
          <KbdGroup className="nx:ml-1">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
        </Button>
        <Button variant="outline" disabled={isSending} onClick={() => void answer(card, { kind: 'cancel' })}>
          Don't send
        </Button>
      </Footer>
    </Card>
  )
}

const HANDOVER_TITLE: Record<Extract<RunCard, { kind: 'handover' }>['what'], string> = {
  captcha: 'CAPTCHA',
  'sign-in': 'Sign-in',
  code: 'One-time code',
  identity: 'Identity check',
  other: 'Your step',
}

function HandoverCard({ card }: { card: Extract<RunCard, { kind: 'handover' }> }): JSX.Element {
  const { answer, showTab } = useContext(Actions)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your turn in Chrome</CardTitle>
        <CardDescription>{card.reason}</CardDescription>
        <CardAction>
          <Badge variant="warning" fill="light" isCaps={false}>
            {HANDOVER_TITLE[card.what]}
          </Badge>
        </CardAction>
      </CardHeader>
      <Footer>
        <Button variant="outline" startIcon={<BrowserIcon />} onClick={() => void showTab(card)}>
          Show tab
        </Button>
        <Button startIcon={<PlayIcon />} onClick={() => void answer(card, { kind: 'resume' })}>
          Done, carry on
        </Button>
      </Footer>
    </Card>
  )
}

function DecisionCard({ card }: { card: Extract<RunCard, { kind: 'decision' }> }): JSX.Element {
  const { answer } = useContext(Actions)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
        {card.body && <CardDescription className="nx:whitespace-pre-line">{card.body}</CardDescription>}
      </CardHeader>
      {(card.facts.length > 0 || card.quote) && (
        <CardContent>
          <div className="nx:flex nx:flex-col nx:gap-3">
            {card.facts.length > 0 && (
              <div className="nx:flex nx:flex-wrap nx:gap-3">
                {card.facts.map(fact => (
                  <div key={fact.label} className="nx:flex nx:flex-col nx:gap-1 nx:p-3 nx:rounded-md nx:border-default nx:border-border-default nx:flex-1">
                    <span className="nx:typography-heading-medium">{fact.value}</span>
                    <span className="nx:typography-body-small nx:text-muted-foreground">{fact.label}</span>
                  </div>
                ))}
              </div>
            )}
            {card.quote && <q className="nx:typography-body-small nx:text-muted-foreground nx:whitespace-pre-wrap">{card.quote}</q>}
          </div>
        </CardContent>
      )}
      <Footer>
        {card.options.map(option => (
          <Button key={option.id} variant={option.isPrimary ? 'default' : 'outline'} title={option.hint || undefined} onClick={() => void answer(card, { kind: 'choose', option: option.id })}>
            {option.label}
          </Button>
        ))}
      </Footer>
    </Card>
  )
}

function QuestionCard({ card }: { card: Extract<RunCard, { kind: 'question' }> }): JSX.Element {
  const { answer } = useContext(Actions)
  const [texts, setTexts] = useState(card.questions.map(() => ''))
  const [save, setSave] = useState(true)
  useEffect(() => setTexts(card.questions.map(() => '')), [card.id])
  const n = card.questions.length
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {n} {n === 1 ? 'question needs' : 'questions need'} you
        </CardTitle>
        <CardDescription>Not in your profile or saved answers.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {card.questions.map((question, i) => (
            <Field key={`${card.id}-${i}`}>
              <FieldLabel htmlFor={`question-${i}`}>{question.question}</FieldLabel>
              <Input
                id={`question-${i}`}
                placeholder={question.hint || undefined}
                value={texts[i] ?? ''}
                onChange={event => setTexts(current => current.map((text, j) => (j === i ? event.target.value : text)))}
              />
            </Field>
          ))}
          <Field orientation="horizontal">
            <Switch id="question-save" size="sm" checked={save} onCheckedChange={setSave} />
            <FieldLabel htmlFor="question-save">Save to form answers</FieldLabel>
          </Field>
        </FieldGroup>
      </CardContent>
      <Footer>
        <Button startIcon={<CheckIcon />} disabled={texts.some(text => !text.trim())} onClick={() => void answer(card, { kind: 'answer', texts, save })}>
          Continue
        </Button>
        <Button variant="outline" onClick={() => void answer(card, { kind: 'cancel' })}>
          Don't apply
        </Button>
      </Footer>
    </Card>
  )
}

function ToolOffCard({ card }: { card: Extract<RunCard, { kind: 'tool-off' }> }): JSX.Element {
  const { answer, showTab } = useContext(Actions)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {card.tool} is off for {TOOL_SITE_NAMES[card.portal]}
        </CardTitle>
        <CardDescription>{card.steps.join(' ')}</CardDescription>
        <CardAction>
          <Badge variant="secondary" fill="light" isCaps={false}>
            Tool off
          </Badge>
        </CardAction>
      </CardHeader>
      <Footer
        end={
          <Button variant="ghost" size="sm" onClick={() => go('/settings/portals')}>
            Change in Settings
          </Button>
        }
      >
        <Button variant="outline" startIcon={<BrowserIcon />} onClick={() => void showTab(card)}>
          Show tab
        </Button>
        <Button startIcon={<CheckIcon />} onClick={() => void answer(card, { kind: 'choose', option: 'done' })}>
          I did it
        </Button>
        <Button variant="ghost" onClick={() => void answer(card, { kind: 'choose', option: 'not-done' })}>
          I didn't
        </Button>
      </Footer>
    </Card>
  )
}

/**
 * The card a waiting session or the chat shows, by kind. A run's card by
 * default; the chat passes its own `actions`. `form` is the session's
 * application form, which a review card counts from.
 */
export function RunCardView({ card, actions, form = null }: { card: RunCard; actions?: CardActions; form?: ApplicationForm | null }): JSX.Element {
  return actions ? (
    <Actions.Provider value={actions}>
      <CardByKind card={card} form={form} />
    </Actions.Provider>
  ) : (
    <CardByKind card={card} form={form} />
  )
}

function CardByKind({ card, form }: { card: RunCard; form: ApplicationForm | null }): JSX.Element {
  switch (card.kind) {
    case 'review':
      return <ReviewCard card={card} form={form} />
    case 'approve':
      return <ApproveCard card={card} />
    case 'handover':
      return <HandoverCard card={card} />
    case 'decision':
      return <DecisionCard card={card} />
    case 'question':
      return <QuestionCard card={card} />
    case 'tool-off':
      return <ToolOffCard card={card} />
  }
}
