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

/** Calendar month numbers in `RepeatForm.months` index order — 0 = January … 11 = December. */
const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const FREQ_TO_UNIT_SINGULAR: Record<ScheduleFreq, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }

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

const WDAY_SHORT: Record<Weekday, string> = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun' }
const WDAY_CODES_SUN_FIRST: Weekday[] = ['su', ...WDAY_CODES_MON_FIRST.slice(0, 6)]

/**
 * The Repeat chip's value text: "every week", "every 2 weeks", "Mon, Wed, Fri",
 * "every 2 weeks on Mon, Wed", "2 days after completion". Weekdays are listed in
 * `weekStartsOn` order (date-fns convention, 0 = Sunday). Monthly and yearly
 * rules deliberately stay at "every month" / "every year".
 */
export function formatRepeatChip(repeat: Repeat, weekStartsOn: 0 | 1 | 6 = 1): string {
  if (repeat.type === 'after_completion') return `${repeat.interval} after completion`
  const n = repeat.interval ?? 1
  const every = n === 1 ? `every ${FREQ_TO_UNIT_SINGULAR[repeat.freq]}` : `every ${serialiseDuration(n, FREQ_TO_DURATION_UNIT[repeat.freq])}`
  if (repeat.freq !== 'weekly' || !repeat.byweekday?.length) return every
  const order = [...WDAY_CODES_SUN_FIRST.slice(weekStartsOn), ...WDAY_CODES_SUN_FIRST.slice(0, weekStartsOn)]
  const days = order.filter(d => repeat.byweekday!.includes(d)).map(d => WDAY_SHORT[d]).join(', ')
  return n === 1 ? days : `${every} on ${days}`
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

/**
 * The last day `repeat` may generate, when it ends on a date — the bound a
 * pattern's own start can't pass (see `startsAfterEnd` in storeOps.ts, and the
 * editor's date pickers, which grey out the days beyond it).
 */
export function repeatUntil(repeat: Repeat | null | undefined): string | undefined {
  return repeat?.end?.type === 'until' ? repeat.end.date : undefined
}

/**
 * `repeat` with every part that only restates `from` — its weekday, its day of
 * the month, its "Nth weekday", its month — restated for `to` instead.
 *
 * What a save means by moving a series' start without touching its rule: the
 * same rule, from the new date. Google Calendar reads it the same way. Without
 * this the stored rule keeps naming the old day (the repeat picker always
 * writes the weekday out: `byweekday: [we]`, not just `weekly`), and a weekly
 * Wednesday series moved to a Friday stays on Wednesdays. A part that names
 * anything else (Mon/Wed/Fri) was the user's own choice and is left alone.
 */
export function followDate(repeat: Repeat, from: string, to: string): Repeat {
  const a = parseDateString(from)
  const b = parseDateString(to)
  if (repeat.type !== 'schedule' || !a || !b || from === to) return repeat
  const r = { ...repeat }
  const only = <T,>(xs: T[] | undefined, x: T) => xs?.length === 1 && xs[0] === x
  if (r.bysetpos === undefined && only(r.byweekday, WDAY_CODE_BY_JS_DAY[a.getDay()])) r.byweekday = [WDAY_CODE_BY_JS_DAY[b.getDay()]!]
  if (r.bysetpos !== undefined) {
    const was = monthlyWeekdaySpec(a)
    if (r.bysetpos === was.bysetpos && only(r.byweekday, was.byweekday[0])) {
      const now = monthlyWeekdaySpec(b)
      r.byweekday = now.byweekday
      r.bysetpos = now.bysetpos
    }
  }
  if (only(r.bymonthday, a.getDate())) r.bymonthday = [b.getDate()]
  if (only(r.bymonth, a.getMonth() + 1)) r.bymonth = [b.getMonth() + 1]
  return r
}

// ── Repeat ⇄ form model ───────────────────────────────────────────────────────
//
// `RepeatForm` is the editable shape a repeat picker works in: one frequency
// dropdown, seven weekday toggles, a month set, a same-day/weekday-pattern
// mode, an end condition. `Repeat` is the flat spec that gets persisted and
// fed to the expansion engine.
//
// The pair below is DELIBERATELY NOT A BIJECTION, and the asymmetry is load-
// bearing — vault files in the wild carry `Repeat` values that a naive
// symmetric round-trip would silently rewrite into different recurrences:
//
//  1. `formToRepeat` re-derives `bymonthday`/`byweekday`+`bysetpos` for monthly
//     AND yearly repeats from `scheduledDate`, NOT from whatever `repeatToForm`
//     parsed. The scheduled date is the anchor; a stored `bymonthday` or
//     weekday-pattern that disagrees with it is stale and gets corrected on
//     save — "the fourth Thursday of November" only survives unchanged when
//     the scheduled date actually falls on the fourth Thursday of some named
//     month; otherwise Set re-anchors it to whatever weekday-pattern the
//     scheduled date itself represents.
//  1a. Yearly's 'same-day' mode never writes `bymonthday` at all: with neither
//     `bymonthday` nor `byweekday` present, every month `bymonth` names (or
//     the anchor's own month, with no `bymonth`) already falls back to the
//     anchor's day-of-month — see `monthCandidates` in `expansion.ts`. Writing
//     it explicitly would just be a redundant field on the single most common
//     yearly repeat (an anniversary/birthday), so it stays implicit.
//  2. `repeatToForm` reads `byweekday` into `wdays` only for `freq: 'weekly'`,
//     because for monthly/yearly repeats the same field means "Nth weekday of
//     the month" rather than "these days each week".
//  3. `repeatToForm` infers `monthly: 'weekday-pattern'` only from the pair
//     (`byweekday` present AND `bysetpos` present) — `bysetpos` alone, or
//     `byweekday` alone on a monthly/yearly repeat, stays 'same-day'.
//  4. An `end: { type: 'until' }` carrying a `time` loses it: the form has no
//     field for time-of-day on an end date, so `repeatToForm` reads only
//     `date` into `endVal` and `formToRepeat` writes back `date` alone.
//  4a. A weekday-pattern the picker cannot author — several positions ("first
//     and third Friday"), or several weekdays under one position — rides
//     through the form as `weekdayPattern` and is written back as it was,
//     instead of being flattened to the single pattern the anchor date implies.
//  4b. `wkst` is carried through as it was. A brand-new repeat takes the
//     user's week-start setting instead (`RepeatFormContext.weekStart`); an
//     existing one without `wkst` keeps none, since adding it would move the
//     dates of a series that already exists. Either way it is written only for
//     a weekly rule with an interval above 1, the only place it changes a date.
//  5. `after_completion` has no form fields for weekdays, months, monthly mode
//     or an end condition, so those are dropped from any `after_completion`
//     repeat that passes through the form.
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
  /**
   * Same-day-of-month vs Nth-weekday-of-month, for `freq: 'monthly'` AND
   * `freq: 'yearly'` alike — both derive it from `scheduledDate` the same way.
   */
  monthly: MonthlyMode
  /** An existing pattern the picker can't express, kept verbatim — see asymmetry 4a. */
  weekdayPattern?: { byweekday: Weekday[]; bysetpos: number | number[] }
  /** Which weekday a weekly rule's weeks start on — see asymmetry 4b. */
  wkst?: Weekday
  /**
   * `freq: 'yearly'` only: which calendar months the repeat spans, January-
   * first (index 0 = January … 11 = December). All-`false` means "no explicit
   * `bymonth`" — the repeat spans only the scheduled date's own month.
   */
  months: boolean[]
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
  /** The user's week-start setting, which a brand-new repeat counts weeks from. */
  weekStart?: Weekday
}

/** Default weekday selection: the day matching `scheduledDate`, or Monday. */
function defaultWdays(scheduledDate?: string | null): boolean[] {
  const wdays = [false, false, false, false, false, false, false]
  const jsDay = parseDateString(scheduledDate ?? '')?.getDay() ?? 1
  wdays[(jsDay + 6) % 7] = true
  return wdays
}

const NO_MONTHS = (): boolean[] => MONTH_NUMBERS.map(() => false)

/**
 * Default month selection for a yearly repeat freshly chosen in the picker:
 * the month `scheduledDate` falls in, or the current calendar month with no
 * parseable date — mirrors `defaultWdays`' scheduled-date-first fallback.
 */
export function defaultMonths(scheduledDate?: string | null): boolean[] {
  const months = NO_MONTHS()
  const d = parseDateString(scheduledDate ?? '')
  months[d ? d.getMonth() : new Date().getMonth()] = true
  return months
}

/** Derive editable form state from an existing Repeat value (or sensible defaults). */
export function repeatToForm(repeat: Repeat | null, ctx: RepeatFormContext): RepeatForm {
  const { scheduledDate, hasSchedule, hasTracking, weekStart } = ctx
  const defaultFreq: RepeatFormFreq = hasTracking && !hasSchedule ? 'after_completion' : 'weekly'

  if (!repeat || repeat.type === 'after_completion') {
    const { n: completionNum, unit: completionUnit } = parseInterval(
      repeat ? repeat.interval : '1 day',
    )
    return {
      freq: repeat ? 'after_completion' : defaultFreq,
      wdays: defaultWdays(scheduledDate),
      monthly: 'same-day',
      ...(weekStart ? { wkst: weekStart } : {}),
      months: NO_MONTHS(),
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
  // monthly/yearly repeat the same field is half of the Nth-weekday pattern.
  const wdays = [false, false, false, false, false, false, false]
  if (s.freq === 'weekly' && s.byweekday) {
    const selected = s.byweekday
    WDAY_CODES_MON_FIRST.forEach((code, i) => { wdays[i] = selected.includes(code) })
  }

  const beyondPicker = monthly === 'weekday-pattern' && s.byweekday && s.bysetpos !== undefined
    && (Array.isArray(s.bysetpos) || s.byweekday.length > 1)
  const weekdayPattern = beyondPicker ? { byweekday: s.byweekday!, bysetpos: s.bysetpos! } : undefined

  const months = MONTH_NUMBERS.map(m => !!s.bymonth?.includes(m))

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
    ...(weekdayPattern ? { weekdayPattern } : {}),
    ...(s.wkst ? { wkst: s.wkst } : {}),
    months,
    endType,
    endVal,
    intervalNum: s.interval ?? 1,
    completionNum,
    completionUnit,
  }
}

/**
 * Build a Repeat value from form state. `scheduledDate` anchors monthly and
 * yearly day-patterns — with no parseable date, neither carries `bymonthday`
 * nor `byweekday`/`bysetpos`.
 */
export function formToRepeat(form: RepeatForm, scheduledDate?: string | null): Repeat {
  const { freq, wdays, monthly, months, endType, endVal } = form

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
    if (form.wkst && form.intervalNum > 1) r.wkst = form.wkst
  }

  if (freq === 'monthly' || freq === 'yearly') {
    const d = parseDateString(scheduledDate ?? '')
    if (d) {
      if (monthly === 'same-day') {
        // Yearly needs no field here at all — see asymmetry 1a in the header.
        if (freq === 'monthly') r.bymonthday = [d.getDate()]
      } else if (form.weekdayPattern) {
        r.byweekday = form.weekdayPattern.byweekday
        r.bysetpos = form.weekdayPattern.bysetpos
      } else {
        const spec = monthlyWeekdaySpec(d)
        r.byweekday = spec.byweekday
        r.bysetpos = spec.bysetpos
      }
    }
  }

  if (freq === 'yearly') {
    const selected = MONTH_NUMBERS.filter((_, i) => months[i])
    if (selected.length) r.bymonth = selected
  }

  if (endType === 'until' && endVal) r.end = { type: 'until', date: endVal }
  if (endType === 'count' && endVal) r.end = { type: 'count', occurrences: parseInt(endVal, 10) }

  return r
}
