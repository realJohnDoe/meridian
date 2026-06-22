/**
 * Shared repeat/interval helpers consumed by both the expansion engine and
 * the RepeatDialog UI.  Keeping parse + serialise in one place ensures the
 * dialog can never write a string the engine fails to parse.
 */

import type { Weekday } from '@/types'

// JS getDay() → Weekday code / full name
const WDAY_CODE_BY_JS_DAY: Weekday[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']
const WDAY_NAME_BY_JS_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Interval string format: "2 weeks", "1 day", "3 months", … ────────────────

export type IntervalParts = { n: number; unit: string }

/** Parse "2 weeks" → { n: 2, unit: 'weeks' }.  Handles all six engine units. */
export function parseInterval(s: string): IntervalParts {
  if (!s) return { n: 1, unit: 'days' }
  const m = s.trim().match(/^(\d+)\s*(day|week|month|year|hour|minute)s?$/i)
  if (!m) return { n: 1, unit: 'days' }
  const unit = m[2].toLowerCase() + 's'
  return { n: parseInt(m[1], 10), unit }
}

/** Serialise { n: 2, unit: 'weeks' } → "2 weeks" (singular when n === 1). */
export function serialiseInterval(n: number, unit: string): string {
  const label = n === 1 ? unit.replace(/s$/, '') : unit
  return `${n} ${label}`
}

// ── Monthly weekday spec ──────────────────────────────────────────────────────

export interface MonthlyWeekdaySpec {
  byweekday: Weekday[]
  bysetpos: number
  label: string
}

/**
 * Given a JS Date, return the byweekday/bysetpos pair that represents
 * "the Nth <weekday> of the month" (or "last <weekday>").
 * Used by RepeatDialog to build a Repeat value, and available for the
 * engine to import if it ever needs the inverse computation.
 */
export function monthlyWeekdaySpec(jsDate: Date): MonthlyWeekdaySpec {
  const jsDay = jsDate.getDay()
  const wdayCode = WDAY_CODE_BY_JS_DAY[jsDay]
  const wdayLabel = WDAY_NAME_BY_JS_DAY[jsDay]

  const year = jsDate.getFullYear()
  const month = jsDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const candidates: number[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month, day).getDay() === jsDay) candidates.push(day)
  }

  const index = candidates.indexOf(jsDate.getDate())
  const isLast = index === candidates.length - 1
  const bysetpos = isLast ? -1 : index + 1
  const ordinal = isLast ? 'last' : ['first', 'second', 'third', 'fourth', 'fifth'][index]

  return {
    byweekday: [wdayCode],
    bysetpos,
    label: `Every ${ordinal} ${wdayLabel} of the month`,
  }
}
