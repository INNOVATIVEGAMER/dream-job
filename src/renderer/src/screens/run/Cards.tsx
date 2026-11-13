import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import {
  BrowserIcon,
  CheckIcon,
  HandPalmIcon,
  LockIcon,
  PaperPlaneTiltIcon,
  PlayIcon,
  QuestionIcon,
  ScalesIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react'

import { TOOL_SITE_NAMES } from '../../../../shared/types'
import type { CardAnswer, RunCard } from '../../../../shared/types'
import { api } from '../../lib/api'
import { go } from '../../lib/router'
import { attempt } from '../../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListItem,
  DescriptionListTerm,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Switch,
  Textarea,
} from '../../ui/nx'

const answer = (card: RunCard, reply: CardAnswer): Promise<void | undefined> => attempt(() => api.runs.answer(card.id, reply))
const front = (): Promise<void | undefined> => attempt(() => api.chrome.front())

function ApproveCard({ card }: { card: Extract<RunCard, { kind: 'approve' }> }): JSX.Element {
  const [texts, setTexts] = useState(card.answers.map(one => one.text))
  useEffect(() => setTexts(card.answers.map(one => one.text)), [card.id])
  return (
    <>
      <Alert variant="warning" layout="inline">
        <AlertIcon>
          <LockIcon />
        </AlertIcon>
        <AlertContent>
          <AlertTitle>{card.isMidForm ? 'Your written answers are held' : 'The submit is held'}</AlertTitle>
          <AlertDescription>
            {card.isMidForm
              ? 'Nothing is typed or sent yet. Approve, and your answers are typed in, the rest of the form is filled from your saved answers, and the application is sent.'
              : 'The form is filled and nothing has been sent. It goes only when you press Submit application.'}
          </AlertDescription>
        </AlertContent>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Your written answers</CardTitle>
          <CardDescription>Drafted from your profile. Edit anything here; your version is typed into the form before it is sent.</CardDescription>
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
          </FieldGroup>
        </CardContent>
      </Card>
      {card.facts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Filled from your form answers</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              {card.facts.map(fact => (
                <DescriptionListItem key={fact.label}>
                  <DescriptionListTerm>{fact.label}</DescriptionListTerm>
                  <DescriptionListDescription>{fact.value}</DescriptionListDescription>
                </DescriptionListItem>
              ))}
            </DescriptionList>
          </CardContent>
        </Card>
      )}
      <div className="nx:flex nx:flex-wrap nx:gap-2">
        <Button startIcon={<PaperPlaneTiltIcon />} onClick={() => void answer(card, { kind: 'approve', texts })}>
          {card.isMidForm ? 'Approve and apply' : 'Submit application'}
        </Button>
        <Button variant="outline" onClick={() => void answer(card, { kind: 'cancel' })}>
          {card.isMidForm ? "Don't apply" : "Don't submit"}
        </Button>
        <Button variant="ghost" startIcon={<BrowserIcon />} onClick={() => void front()}>
          See the form in Chrome
        </Button>
      </div>
    </>
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
          <Badge variant="warning" fill="light" isCaps={false} leftIcon={<HandPalmIcon />}>
            {HANDOVER_TITLE[card.what]}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ol className="nx:typography-body-default nx:m-0 nx:pl-5 nx:flex nx:flex-col nx:gap-2">
          <li>Bring Chrome forward. The page is open where the run stopped.</li>
          <li>Do the step yourself. Leave the rest of the page as it is.</li>
          <li>Come back and press Resume. Claude reads the page again and carries on.</li>
        </ol>
      </CardContent>
      <CardFooter>
        <div className="nx:flex nx:flex-wrap nx:gap-2">
          <Button variant="outline" startIcon={<BrowserIcon />} onClick={() => void front()}>
            Bring Chrome forward
          </Button>
          <Button startIcon={<PlayIcon />} onClick={() => void answer(card, { kind: 'resume' })}>
            Resume
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

function DecisionCard({ card }: { card: Extract<RunCard, { kind: 'decision' }> }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
        <CardDescription>{card.body}</CardDescription>
        <CardAction>
          <Badge variant="warning" fill="light" isCaps={false} leftIcon={<ScalesIcon />}>
            Decision
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="nx:flex nx:flex-col nx:gap-4">
          {card.facts.length > 0 && (
            <div className="nx:grid nx:gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {card.facts.map(fact => (
                <div key={fact.label} className="nx:flex nx:flex-col nx:gap-1 nx:p-3 nx:rounded-md nx:border-default nx:border-border-default">
                  <span className="nx:typography-body-small nx:text-muted-foreground">{fact.label}</span>
                  <span className="nx:typography-heading-medium">{fact.value}</span>
                </div>
              ))}
            </div>
          )}
          {card.quote && (
            <div className="nx:flex nx:flex-col nx:gap-1">
              <span className="nx:typography-label-caps nx:text-muted-foreground">From the posting</span>
              <q className="nx:typography-body-default">{card.quote}</q>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <div className="nx:flex nx:flex-col nx:gap-3">
          <div className="nx:flex nx:flex-wrap nx:gap-2">
            {card.options.map(option => (
              <Button key={option.id} variant={option.isPrimary ? 'default' : 'outline'} onClick={() => void answer(card, { kind: 'choose', option: option.id })}>
                {option.label}
              </Button>
            ))}
          </div>
          <span className="nx:typography-body-small nx:text-muted-foreground">{card.options.map(option => option.hint).filter(Boolean).join(' ')}</span>
        </div>
      </CardFooter>
    </Card>
  )
}

function QuestionCard({ card }: { card: Extract<RunCard, { kind: 'question' }> }): JSX.Element {
  const [texts, setTexts] = useState(card.questions.map(() => ''))
  const [save, setSave] = useState(true)
  useEffect(() => setTexts(card.questions.map(() => '')), [card.id])
  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.questions.length === 1 ? "A question you haven't answered yet" : "Questions you haven't answered yet"}</CardTitle>
        <CardDescription>The form asks facts that aren't in your profile or saved answers. Claude doesn't guess facts about you, so it asks once. {card.context}</CardDescription>
        <CardAction>
          <Badge variant="warning" fill="light" isCaps={false} leftIcon={<QuestionIcon />}>
            Question
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {card.questions.map((question, i) => (
            <Field key={`${card.id}-${i}`}>
              <FieldLabel htmlFor={`question-${i}`}>{question.question}</FieldLabel>
              <Input
                id={`question-${i}`}
                value={texts[i] ?? ''}
                onChange={event => setTexts(current => current.map((text, j) => (j === i ? event.target.value : text)))}
              />
              {question.hint && <FieldDescription>{question.hint}</FieldDescription>}
            </Field>
          ))}
          <Field orientation="horizontal">
            <Switch id="question-save" checked={save} onCheckedChange={setSave} />
            <FieldLabel htmlFor="question-save">Save to Form answers, so later forms don't ask again</FieldLabel>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <div className="nx:flex nx:flex-wrap nx:gap-2">
          <Button startIcon={<CheckIcon />} disabled={texts.some(text => !text.trim())} onClick={() => void answer(card, { kind: 'answer', texts, save })}>
            Use {card.questions.length === 1 ? 'this answer' : 'these answers'}
          </Button>
          <Button variant="outline" onClick={() => void answer(card, { kind: 'cancel' })}>
            Don't apply
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

function ToolOffCard({ card }: { card: Extract<RunCard, { kind: 'tool-off' }> }): JSX.Element {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {card.tool} is off for Claude on {TOOL_SITE_NAMES[card.portal]}
          </CardTitle>
          <CardDescription>You turned it off in Settings, Portals. Everything before this step is done.</CardDescription>
          <CardAction>
            <Badge variant="secondary" fill="light" isCaps={false} leftIcon={<SlidersHorizontalIcon />}>
              Tool off
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ol className="nx:typography-body-default nx:m-0 nx:pl-5 nx:flex nx:flex-col nx:gap-2">
            {card.steps.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </CardContent>
        <CardFooter>
          <div className="nx:flex nx:flex-wrap nx:gap-2">
            <Button variant="outline" startIcon={<BrowserIcon />} onClick={() => void front()}>
              Bring Chrome forward
            </Button>
            <Button startIcon={<CheckIcon />} onClick={() => void answer(card, { kind: 'choose', option: 'done' })}>
              I did it
            </Button>
            <Button variant="ghost" onClick={() => void answer(card, { kind: 'choose', option: 'not-done' })}>
              I didn't
            </Button>
          </div>
        </CardFooter>
      </Card>
      <div>
        <Button variant="ghost" size="sm" startIcon={<SlidersHorizontalIcon />} onClick={() => go('/settings/portals')}>
          Change what Claude may do on {TOOL_SITE_NAMES[card.portal]}
        </Button>
      </div>
    </>
  )
}

/** The card a waiting run shows, by kind. */
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
