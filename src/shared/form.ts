import type { FormField } from './types'

const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Whether two answers to a field are the same: a choice by its words whatever the case, text as typed. */
export function sameAnswer(field: Pick<FormField, 'kind'>, a: string, b: string): boolean {
  const isChoice = field.kind === 'select' || field.kind === 'radio' || field.kind === 'checkbox'
  return isChoice ? squeeze(a).toLowerCase() === squeeze(b).toLowerCase() : squeeze(a) === squeeze(b)
}

/** An answer you or the chat set that the page does not hold yet. */
export const isPending = (field: FormField): boolean => field.wanted !== null && !sameAnswer(field, field.wanted, field.value)

/** The answer a field goes out with: yours when you set one, else what the page holds. */
export const answerOf = (field: FormField): string => field.wanted ?? field.value

/** A required field with nothing in it. An unticked required checkbox counts: it is usually a consent. */
export const isMissing = (field: FormField): boolean => field.isRequired && (field.kind === 'checkbox' ? answerOf(field) !== 'Yes' : !answerOf(field).trim())
