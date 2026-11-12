import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { ArrowSquareOutIcon, CheckCircleIcon, CheckIcon, CopyIcon, InfoIcon } from '@phosphor-icons/react'

import { api } from '../lib/api'
import { useData } from '../lib/data'
import { day } from '../lib/format'
import { go } from '../lib/router'
import { attempt, ErrorNote, Loading, Page } from '../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Textarea,
  toast,
} from '../ui/nx'

/** A thank-you to someone who referred the user: drafted here, sent by the user. */
export function Thanks({ id }: { id: number }): JSX.Element {
  const contact = useData(() => api.contacts.get(id), [id], ['contacts'])
  const [text, setText] = useState('')
  const person = contact.data

  useEffect(() => {
    if (!person) return
    const first = person.name.split(' ')[0] ?? person.name
    setText(`Hi ${first}, thank you for referring me at ${person.company}. I really appreciate you taking the time.`)
  }, [person?.id])

  if (contact.error) return <Page title="Thank-you"><ErrorNote text={contact.error} /></Page>
  if (!person) return <Page title="Thank-you"><Loading /></Page>

  return (
    <Page
      narrow
      back={{ label: 'Contacts', to: '/contacts' }}
      meta={`${person.company}, ${person.role}`}
      title={`Thank ${person.name}`}
      badge={
        person.referredAt ? (
          <Badge variant="success" fill="light" isCaps={false} leftIcon={<CheckCircleIcon />}>
            Referred you, {day(person.referredAt)}
          </Badge>
        ) : undefined
      }
      description="A thank-you is owed and carries no question. It isn't your approved message, so the app drafts it and you send it."
    >
      <Card>
        <CardHeader>
          <CardTitle>Draft</CardTitle>
          <CardDescription>Edit it as you like. Nothing here is sent by the app.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="thanks-body">Message</FieldLabel>
            <Textarea id="thanks-body" rows={5} value={text} onChange={event => setText(event.target.value)} />
          </Field>
        </CardContent>
        <CardFooter>
          <div className="nx:flex nx:flex-wrap nx:gap-2">
            <Button
              startIcon={<CopyIcon />}
              onClick={() =>
                void navigator.clipboard.writeText(text).then(
                  () => toast.success('Copied'),
                  () => toast.error('Could not copy. Select the text and copy it.'),
                )
              }
            >
              Copy message
            </Button>
            <Button variant="outline" startIcon={<ArrowSquareOutIcon />} onClick={() => void attempt(() => api.chrome.openUrl(person.profileUrl))}>
              Open their profile in Chrome
            </Button>
            <Button
              variant="ghost"
              startIcon={<CheckIcon />}
              onClick={() => void attempt(() => api.contacts.markThanked(person.id), 'Marked as thanked').then(() => go('/contacts'))}
            >
              Mark as thanked
            </Button>
          </div>
        </CardFooter>
      </Card>
      <Alert variant="information" layout="inline">
        <AlertIcon>
          <InfoIcon />
        </AlertIcon>
        <AlertContent>
          <AlertTitle>Other drafts work the same way</AlertTitle>
          <AlertDescription>A reply in a thread, or a note to a recruiter, is drafted for you to copy and send. Only the approved referral message goes out from the app.</AlertDescription>
        </AlertContent>
      </Alert>
    </Page>
  )
}
