/*
 * Years of experience as postings write them: "3+ years", "3-5 yrs",
 * "between 2 and 5 years", "a minimum of four years". Only numbers that
 * state years count, so the 2 in "B2B" or the 0 in "0 to 1 stage" never do.
 */

export const FRESHER = /fresher|entry[- ]level|new grads?|graduate|no (prior )?experience|0\s*-/i

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
}
// Longest first, so "fourteen" is tried before "four".
const NUMBER = `(\\d+(?:\\.\\d+)?|${Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join('|')})`

/**
 * A statement of years: a number (or a range, "3-5", "2 to 5", "between 2
 * and 5") right before "years" or "yrs", with "+", "(4)" or "or more" allowed
 * between. A number not about years, such as the 2 in "B2B" or the 0 in "0 to
 * 1 stage", is not one.
 */
const YEARS = new RegExp(
  `(?<![\\w.])${NUMBER}\\s*\\+?\\s*(?:(?:-|–|—|to|or|and)\\s*${NUMBER}\\s*\\+?\\s*)?(?:\\(\\s*\\d+\\s*\\)\\s*)?(?:or more\\s*|plus\\s*)?(?:years?|yrs?)\\b`,
  'gi',
)

const numberOf = (word: string): number => WORD_NUMBERS[word.toLowerCase()] ?? Number(word)

/** The fewest years each statement of years in a text asks for: "3-5 years" gives 3, "four years" 4. */
export function yearsStated(text: string): number[] {
  return [...text.matchAll(YEARS)].map(match => numberOf(match[1]!)).filter(n => Number.isFinite(n) && n <= 40)
}

/** The fewest years a portal's own experience field states, such as "4-6 Years" or "Any (new grads ok)"; null when it states none. */
export function fieldYears(text: string): number | null {
  const stated = yearsStated(text)
  if (stated.length) return Math.floor(Math.min(...stated))
  return FRESHER.test(text) ? 0 : null
}
