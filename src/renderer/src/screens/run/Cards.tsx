import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { BrowserIcon, CaretDownIcon, CheckIcon, PaperPlaneTiltIcon, PlayIcon } from '@phosphor-icons/react'

import { TOOL_SITE_NAMES } from '../../../../shared/types'
import type { CardAnswer, RunCard } from '../../../../shared/types'
import { api } from '../../lib/api'
import { go } from '../../lib/router'
import { attempt } from '../../ui/common'
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

const answer = (card: RunCard, reply: CardAnswer): Promise<void | undefined> => attempt(() => api.runs.answer(card.id, reply))
/** Shows the tab of the session waiting on this card: its own tab when the run has several, else the one Chrome shows. */
const showTab = (card: RunCard): Promise<void | undefined> => attempt(() => api.runs.showTab(card.id))

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

const HANDOVER_TITLE: Record<Extract<RunCard, { kind: 'handover' }>['what'], string> = {
  captcha: 'CAPTCHA',
  'sign-in': 'Sign-in',
  code: 'One-time code',
  identity: 'Identity check',
  other: 'Your step',
}

function HandoverCard({ card }: { card: Extract<RunCard, { kind: 'handover' }> }): JSX.Element {
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
        {card.body && <CardDescription>{card.body}</CardDescription>}
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
            {card.quote && <q className="nx:typography-body-small nx:text-muted-foreground">{card.quote}</q>}
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

/** The card a waiting session shows, by kind. */
export function RunCardView({ card }: { card: RunCard }): JSX.Element {
  switch (card.kind) {
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
