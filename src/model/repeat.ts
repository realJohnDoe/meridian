/**
 * Shared repeat/interval helpers consumed by both the expansion engine and
 * the RepeatDialog UI.  Keeping parse + serialise in one place ensures the
 * dialog can never write a string the engine fails to parse.
 */

import type { Repeat, Weekday } from '@/types'
import { parseDateString } from './dateUtils'
import { parseDuration, serialiseDuration, type DurationUnit } from './duration'

// JS getDay() → Weekday code / full name
const WDAY_CODE_BY_JS_DAY: Weekday[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']
/** Weekday codes in `RepeatForm.wdays` index order — 0 = Monday … 6 = Sunday. */
const WDAY_CODES_MON_FIRST: Weekday[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']
const WDAY_NAME_BY_JS_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Interval string format: "2 weeks", "1 day", "3 months", … ────────────────

export type IntervalParts = { n: number; unit: DurationUnit }

/** Parse "2 weeks" (or "2w") → { n: 2, unit: 'weeks' }. Delegates to the same
 * canonical parser `duration.ts` uses, so the engine and the dialogs agree on
 * exactly one unit vocabulary. */
export function parseInterval(s: string): IntervalParts {
  if (!s) return { n: 1, unit: 'days' }
  return parseDuration(s) ?? { n: 1, unit: 'days' }
}

/** Serialise { n: 2, unit: 'weeks' } → "2 weeks" (singular when n === 1). */
export function serialiseInterval(n: number, unit: DurationUnit): string {
  return serialiseDuration(n, unit)
}

const FREQ_TO_DURATION_UNIT: Record<ScheduleFreq, DurationUnit> = {
  daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years',
}

/** The Repeat chip's value text: "every 2 weeks", "every day", "2 days after completion". */
export function formatRepeatChip(repeat: Repeat): string {
  if (repeat.type === 'after_completion') return `${repeat.interval} after completion`
  return `every ${serialiseDuration(repeat.interval ?? 1, FREQ_TO_DURATION_UNIT[repeat.freq])}`
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
  const wdayCode = WDAY_CODE_BY_JS_DAY[jsDay]!  // getDay() is always 0–6
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

// ── Repeat ⇄ form model ───────────────────────────────────────────────────────
//
// `RepeatForm` is the editable shape a repeat picker works in: one frequency
// dropdown, seven weekday toggles, a monthly mode, an end condition. `Repeat`
// is the flat spec that gets persisted and fed to the expansion engine.
//
// The pair below is DELIBERATELY NOT A BIJECTION, and the asymmetry is load-
// bearing — vault files in the wild carry `Repeat` values that a naive
// symmetric round-trip would silently rewrite into different recurrences:
//
//  1. `formToRepeat` re-derives `bymonthday`/`byweekday`+`bysetpos` for monthly
//     repeats from `scheduledDate`, NOT from whatever `repeatToForm` parsed.
//     The scheduled date is the anchor; a stored `bymonthday` that disagrees
//     with it is stale and gets corrected on save.
//  2. `repeatToForm` reads `byweekday` into `wdays` only for `freq: 'weekly'`,
//     because for monthly repeats the same field means "Nth weekday of month"
//     rather than "these days each week".
//  3. `repeatToForm` infers `monthly: 'weekday-pattern'` only from the pair
//     (`byweekday` present AND `bysetpos` present) — `bysetpos` alone, or
//     `byweekday` alone on a monthly repeat, stays 'same-day'.
//  4. An `end: { type: 'until' }` carrying a `time` loses it: the form has no
//     field for time-of-day on an end date, so `repeatToForm` reads only
//     `date` into `endVal` and `formToRepeat` writes back `date` alone.
//  5. `after_completion` has no form fields for weekdays, monthly mode or an
//     end condition, so those are dropped from any `after_completion` repeat
//     that passes through the form.
//  6. A yearly repeat's `bymonth`/`bymonthday`/`byweekday`+`bysetpos` are
//     carried across from the repeat the form was opened on, not rebuilt from
//     form state. The form has no control for any of them, so rebuilding would
//     turn "the fourth Thursday of November" into "November 27th" the first
//     time someone opened the dialog and pressed Set — silently, and on a rule
//     they never touched. The monthly fields above are the opposite case: the
//     form *does* express them, so they are re-derived from the anchor.
//
// Changing any of these changes which vault files survive an open-and-Set
// cycle unchanged — see `model/__tests__/repeatForm.test.ts`.

export type ScheduleFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type RepeatFormFreq = ScheduleFreq | 'after_completion'
export type MonthlyMode = 'same-day' | 'weekday-pattern'
export type RepeatEndType = 'never' | 'until' | 'count'

export interface RepeatForm {
  freq: RepeatFormFreq
  /** Monday-first weekday selection: index 0 = Mon … 6 = Sun, regardless of locale. */
  wdays: boolean[]
  monthly: MonthlyMode
  endType: RepeatEndType
  /** ISO date when `endType` is 'until'; occurrence count as a string when 'count'. */
  endVal: string
  intervalNum: number
  completionNum: number
  completionUnit: DurationUnit
}

export interface RepeatFormContext {
  /** ISO date the item is scheduled on — the anchor monthly patterns derive from. */
  scheduledDate?: string | null
  /** The item has a scheduled date. */
  hasSchedule: boolean
  /** The item tracks completion, so "after completion" is an available mode. */
  hasTracking: boolean
}

/** Default weekday selection: the day matching `scheduledDate`, or Monday. */
function defaultWdays(scheduledDate?: string | null): boolean[] {
  const wdays = [false, false, false, false, false, false, false]
  const jsDay = parseDateString(scheduledDate ?? '')?.getDay() ?? 1
  wdays[(jsDay + 6) % 7] = true
  return wdays
}

/** Derive editable form state from an existing Repeat value (or sensible defaults). */
export function repeatToForm(repeat: Repeat | null, ctx: RepeatFormContext): RepeatForm {
  const { scheduledDate, hasSchedule, hasTracking } = ctx
  const defaultFreq: RepeatFormFreq = hasTracking && !hasSchedule ? 'after_completion' : 'weekly'

  if (!repeat || repeat.type === 'after_completion') {
    const { n: completionNum, unit: completionUnit } = parseInterval(
      repeat ? repeat.interval : '1 day',
    )
    return {
      freq: repeat ? 'after_completion' : defaultFreq,
      wdays: defaultWdays(scheduledDate),
      monthly: 'same-day',
      endType: 'never',
      endVal: '',
      intervalNum: 1,
      completionNum,
      completionUnit,
    }
  }

  // Scheduled repeat: reverse-engineer state from the flat spec
  const s = repeat

  const monthly: MonthlyMode =
    s.byweekday && s.bysetpos !== undefined ? 'weekday-pattern' : 'same-day'

  // Only weekly repeats mean "these days each week" by `byweekday`; on a
  // monthly repeat the same field is half of the Nth-weekday pattern.
  const wdays = [false, false, false, false, false, false, false]
  if (s.freq === 'weekly' && s.byweekday) {
    const selected = s.byweekday
    WDAY_CODES_MON_FIRST.forEach((code, i) => { wdays[i] = selected.includes(code) })
  }

  let endType: RepeatEndType = 'never'
  let endVal = ''
  if (s.end?.type === 'until') {
    endType = 'until'
    endVal = s.end.date ?? ''
  } else if (s.end?.type === 'count') {
    endType = 'count'
    endVal = String(s.end.occurrences)
  }

  const { n: completionNum, unit: completionUnit } = parseInterval('1 day')
  return {
    freq: s.freq,
    wdays,
    monthly,
    endType,
    endVal,
    intervalNum: s.interval ?? 1,
    completionNum,
    completionUnit,
  }
}

/**
 * Build a Repeat value from form state. `scheduledDate` anchors monthly
 * patterns — with no parseable date, a monthly repeat carries neither
 * `bymonthday` nor `byweekday`/`bysetpos`.
 *
 * `previous` is the repeat the form was opened on, and exists only to carry
 * yearly's BY* fields through a form that cannot show them — see asymmetry 6
 * in the header. Omitting it drops them.
 */
export function formToRepeat(form: RepeatForm, scheduledDate?: string | null, previous?: Repeat | null): Repeat {
  const { freq, wdays, monthly, endType, endVal } = form

  if (freq === 'after_completion') {
    return {
      type: 'after_completion',
      interval: serialiseInterval(Math.max(1, form.completionNum), form.completionUnit),
    }
  }

  const r: Repeat = {
    type: 'schedule',
    freq,
    interval: Math.max(1, form.intervalNum),
  }

  if (freq === 'weekly') {
    r.byweekday = WDAY_CODES_MON_FIRST.filter((_, i) => wdays[i])
  }

  if (freq === 'monthly') {
    const d = parseDateString(scheduledDate ?? '')
    if (d) {
      if (monthly === 'same-day') {
        r.bymonthday = [d.getDate()]
      } else {
        const spec = monthlyWeekdaySpec(d)
        r.byweekday = spec.byweekday
        r.bysetpos = spec.bysetpos
      }
    }
  }

  if (freq === 'yearly' && previous?.type === 'schedule' && previous.freq === 'yearly') {
    // Only what the form cannot express, and only when the frequency it
    // belongs to is still the one selected.
    if (previous.bymonth?.length) r.bymonth = previous.bymonth
    if (previous.bymonthday?.length) r.bymonthday = previous.bymonthday
    if (previous.byweekday?.length && previous.bysetpos !== undefined) {
      r.byweekday = previous.byweekday
      r.bysetpos = previous.bysetpos
    }
  }

  if (endType === 'until' && endVal) r.end = { type: 'until', date: endVal }
  if (endType === 'count' && endVal) r.end = { type: 'count', occurrences: parseInt(endVal, 10) }

  return r
}
