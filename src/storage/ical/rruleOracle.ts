import { parseIcsDateTime, localDate } from './icsDateTime'
import { byDayList, intList, JS_DAY_BY_ICS, type RRuleParts } from './rruleToRepeat'

/** How far the expansion reaches, relative to today. */
const WINDOW_BEFORE_MS = 365 * 86_400_000
const WINDOW_AFTER_MS  = 2 * 365 * 86_400_000
/**
 * A hard stop on the walk, independent of the window. Sub-daily rules
 * (`FREQ=HOURLY`) would otherwise emit tens of thousands of occurrences for one
 * event, and a feed can hold hundreds of events.
 */
export const MAX_OCCURRENCES = 750

// ── RFC 5545 reference walk ──────────────────────────────────────────────────
//
// Test oracle for `repeatToRrule.test.ts`: expands an RRULE into explicit dates
// over a bounded window, so the engine's output can be compared with the RFC's.
// Nothing in production calls it.

const FREQ_STEP_MS: Record<string, number> = {
  SECONDLY: 1_000,
  MINUTELY: 60_000,
  HOURLY:   3_600_000,
}

/** Hard stop on the period walk, so a pathological rule cannot spin. */
const MAX_PERIODS = 4_000

/** The BY* parts, resolved once per rule. */
interface ByParts {
  byDay:      Array<{ ordinal?: number; day: string }>
  byMonthDay: number[]
  byMonth:    number[]
  bySetPos:   number[]
  byYearDay:  number[]
  byWeekNo:   number[]
  wkst:       number
}

function readByParts(parts: RRuleParts): ByParts {
  return {
    byDay:      byDayList(parts) ?? [],
    byMonthDay: intList(parts['BYMONTHDAY']) ?? [],
    byMonth:    intList(parts['BYMONTH']) ?? [],
    bySetPos:   intList(parts['BYSETPOS']) ?? [],
    byYearDay:  intList(parts['BYYEARDAY']) ?? [],
    byWeekNo:   intList(parts['BYWEEKNO']) ?? [],
    wkst:       JS_DAY_BY_ICS[(parts['WKST'] ?? 'MO').toUpperCase()] ?? 1,
  }
}

const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const daysInMonth = (year: number, month0: number): number => new Date(year, month0 + 1, 0).getDate()
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Day-of-year, 1-based. */
function dayOfYear(d: Date): number {
  return Math.round((midnight(d).getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1
}

/** ISO-8601 week number — what `BYWEEKNO` counts, on the rule's own `WKST`. */
function weekNumber(d: Date, wkst: number): number {
  const start = weekStart(d, wkst)
  const jan1 = new Date(start.getFullYear(), 0, 1)
  return Math.floor((start.getTime() - weekStart(jan1, wkst).getTime()) / (7 * 86_400_000)) + 1
}

function weekStart(d: Date, wkst: number): Date {
  return addDays(midnight(d), -(((d.getDay() - wkst) + 7) % 7))
}

/**
 * Days of `month0` matching a BYDAY list, honouring ordinal prefixes.
 *
 * `2FR` is the second Friday, `-1SU` the last Sunday; a bare `FR` is every
 * Friday. Ordinals are resolved within the month, which is what they mean for
 * MONTHLY and — since we walk YEARLY month by month — for the `BYMONTH=11;
 * BYDAY=4TH` shape too.
 */
function byDayMatchesInMonth(year: number, month0: number, byDay: ByParts['byDay']): number[] {
  const out = new Set<number>()
  for (const { ordinal, day } of byDay) {
    const dow = JS_DAY_BY_ICS[day]
    if (dow === undefined) continue
    const all: number[] = []
    for (let d = 1; d <= daysInMonth(year, month0); d++) {
      if (new Date(year, month0, d).getDay() === dow) all.push(d)
    }
    if (ordinal === undefined) { all.forEach(d => out.add(d)); continue }
    const picked = ordinal > 0 ? all[ordinal - 1] : all[all.length + ordinal]
    if (picked !== undefined) out.add(picked)
  }
  return [...out].sort((a, b) => a - b)
}

/** Resolve BYMONTHDAY entries (including negatives, `-1` = last) against one month. */
function monthDaysIn(year: number, month0: number, byMonthDay: number[]): number[] {
  const len = daysInMonth(year, month0)
  const out = new Set<number>()
  for (const raw of byMonthDay) {
    const d = raw > 0 ? raw : len + raw + 1
    if (d >= 1 && d <= len) out.add(d)
  }
  return [...out].sort((a, b) => a - b)
}

/** The dates one month contributes, before period-level BYSETPOS and limits. */
function monthCandidates(year: number, month0: number, by: ByParts, anchor: Date): Date[] {
  let days: number[]
  if (by.byMonthDay.length > 0) {
    days = monthDaysIn(year, month0, by.byMonthDay)
    if (by.byDay.length > 0) {
      // Both present: BYDAY narrows BYMONTHDAY rather than adding to it.
      const dows = new Set(by.byDay.map(d => JS_DAY_BY_ICS[d.day]))
      days = days.filter(d => dows.has(new Date(year, month0, d).getDay()))
    }
  } else if (by.byDay.length > 0) {
    days = byDayMatchesInMonth(year, month0, by.byDay)
  } else {
    // Nothing names a day, so the rule repeats the anchor's own day-of-month.
    // A month too short for it is skipped, never rolled into the next.
    days = anchor.getDate() <= daysInMonth(year, month0) ? [anchor.getDate()] : []
  }
  return days.map(d => new Date(year, month0, d))
}

/** The dates one period contributes, before BYSETPOS. */
function periodCandidates(freq: string, periodStart: Date, by: ByParts, anchor: Date): Date[] {
  if (freq === 'DAILY') return [periodStart]

  if (freq === 'WEEKLY') {
    const dows = by.byDay.length > 0
      ? new Set(by.byDay.map(d => JS_DAY_BY_ICS[d.day]))
      : new Set([anchor.getDay()])
    const out: Date[] = []
    for (let i = 0; i < 7; i++) {
      const day = addDays(periodStart, i)
      if (dows.has(day.getDay())) out.push(day)
    }
    return out
  }

  if (freq === 'MONTHLY') {
    return monthCandidates(periodStart.getFullYear(), periodStart.getMonth(), by, anchor)
  }

  // YEARLY. BYMONTH expands to the months it names; with no BY* part naming a
  // day at all, the rule simply repeats the anchor's month and day.
  const year = periodStart.getFullYear()
  const namesADay = by.byDay.length > 0 || by.byMonthDay.length > 0 || by.byYearDay.length > 0 || by.byWeekNo.length > 0
  const months = by.byMonth.length > 0
    ? by.byMonth.filter(m => m >= 1 && m <= 12).map(m => m - 1)
    : namesADay ? [...Array(12).keys()] : [anchor.getMonth()]

  const out: Date[] = []
  for (const month0 of months) out.push(...monthCandidates(year, month0, by, anchor))
  return out.sort((a, b) => a.getTime() - b.getTime())
}

/**
 * Limits that apply after a period's candidates are built, whatever produced
 * them.
 *
 * Which BY* part is an *expansion* and which is a *limit* depends on FREQ (RFC
 * 5545 §3.3.10's table). A daily period is a single day, so BYDAY and
 * BYMONTHDAY can only narrow it — `FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR`, the
 * weekdays-only rule every task tracker emits, is exactly that. For the coarser
 * frequencies the same parts *choose* the days, which `periodCandidates` has
 * already done by the time this runs. BYMONTH is likewise an expansion for
 * YEARLY and a limit everywhere else.
 */
function passesLimits(d: Date, freq: string, by: ByParts): boolean {
  if (freq !== 'YEARLY' && by.byMonth.length > 0 && !by.byMonth.includes(d.getMonth() + 1)) return false
  if (freq === 'DAILY') {
    if (by.byDay.length > 0) {
      const dows = new Set(by.byDay.map(x => JS_DAY_BY_ICS[x.day]))
      if (!dows.has(d.getDay())) return false
    }
    if (by.byMonthDay.length > 0 && !monthDaysIn(d.getFullYear(), d.getMonth(), by.byMonthDay).includes(d.getDate())) {
      return false
    }
  }
  if (by.byYearDay.length > 0) {
    const doy = dayOfYear(d)
    const len = dayOfYear(new Date(d.getFullYear(), 11, 31)) // 365, or 366 in a leap year
    if (!by.byYearDay.some(n => (n > 0 ? n : len + n + 1) === doy)) return false
  }
  if (by.byWeekNo.length > 0 && !by.byWeekNo.includes(weekNumber(d, by.wkst))) return false
  return true
}

/** Apply BYSETPOS to one period's ordered candidates. */
function applySetPos(candidates: Date[], bySetPos: number[]): Date[] {
  if (bySetPos.length === 0) return candidates
  const picked: Date[] = []
  for (const pos of bySetPos) {
    const at = pos > 0 ? candidates[pos - 1] : candidates[candidates.length + pos]
    if (at) picked.push(at)
  }
  return picked.sort((a, b) => a.getTime() - b.getTime())
}

/** The start of the period `n` base periods on from the anchor's own period. */
function periodStartAt(freq: string, anchor: Date, by: ByParts, n: number): Date {
  const a = midnight(anchor)
  if (freq === 'WEEKLY')  return addDays(weekStart(a, by.wkst), 7 * n)
  if (freq === 'MONTHLY') return new Date(a.getFullYear(), a.getMonth() + n, 1)
  if (freq === 'YEARLY')  return new Date(a.getFullYear() + n, 0, 1)
  return addDays(a, n) // DAILY
}

/** How many base periods separate the anchor's period from `target`'s. */
function periodsBetween(freq: string, anchor: Date, by: ByParts, target: Date): number {
  const a = midnight(anchor)
  if (freq === 'WEEKLY') {
    return Math.floor((weekStart(target, by.wkst).getTime() - weekStart(a, by.wkst).getTime()) / (7 * 86_400_000))
  }
  if (freq === 'MONTHLY') return (target.getFullYear() - a.getFullYear()) * 12 + (target.getMonth() - a.getMonth())
  if (freq === 'YEARLY')  return target.getFullYear() - a.getFullYear()
  return Math.floor((midnight(target).getTime() - a.getTime()) / 86_400_000) // DAILY
}

/**
 * Sub-daily rules (`FREQ=HOURLY` and finer), reduced to the set of days they
 * touch. The caller writes dates, so every occurrence within a day collapses to
 * that one day — which is the only sane rendering of an hourly rule on a
 * calendar that has no concept of one.
 */
function expandSubDaily(stepMs: number, parts: RRuleParts, anchor: Date, now: Date): string[] {
  const interval = Math.max(1, Math.trunc(Number(parts['INTERVAL'] ?? 1)) || 1)
  const by = readByParts(parts)
  const dows = new Set(by.byDay.map(d => JS_DAY_BY_ICS[d.day]))

  const windowStart = now.getTime() - WINDOW_BEFORE_MS
  const windowEnd   = now.getTime() + WINDOW_AFTER_MS
  const { maxOccurrences, untilMs } = boundsOf(parts)

  const dates = new Set<string>()
  let cursor = anchor.getTime()
  let emitted = 0
  for (let step = 0; step < 60_000 && emitted < maxOccurrences && dates.size < MAX_OCCURRENCES; step++) {
    if (cursor > untilMs || cursor > windowEnd) break
    const d = new Date(cursor)
    if ((dows.size === 0 || dows.has(d.getDay()))
      && (by.byMonth.length === 0 || by.byMonth.includes(d.getMonth() + 1))) {
      emitted++
      if (cursor >= windowStart) dates.add(localDate(d))
    }
    cursor += stepMs * interval
  }
  return [...dates].sort()
}

function boundsOf(parts: RRuleParts): { maxOccurrences: number; untilMs: number } {
  const count = Number(parts['COUNT'])
  const until = parts['UNTIL'] ? parseIcsDateTime(parts['UNTIL']) : null
  return {
    maxOccurrences: Number.isInteger(count) && count > 0 ? count : Infinity,
    // An all-day UNTIL bounds the whole of that day, so compare against its end.
    untilMs: until ? (until.allDay ? addDays(until.when, 1).getTime() - 1 : until.when.getTime()) : Infinity,
  }
}

/**
 * Walk an RRULE ourselves and return the dates it produces inside the window.
 *
 * Follows RFC 5545's own shape — build each period's candidate dates, apply the
 * limits, then BYSETPOS, then emit in order — rather than stepping a cursor,
 * because the parts that reach this function are exactly the ones a cursor
 * cannot express: `BYDAY=MO,WE,FR` names three dates in one period, and
 * `BYSETPOS=-1` cannot be decided until the whole period is known.
 *
 * `BYYEARDAY` and `BYWEEKNO` are honoured as limits only, never as expansions;
 * no mainstream exporter emits either.
 *
 * Counting starts at the anchor, not at the window, because `COUNT` counts every
 * occurrence the rule ever produced — a series that ran out before the window
 * opened must come back empty, not full.
 *
 * An empty result means "no recurrence": an unreadable or unsupported `FREQ`,
 * or a series that ended before the window.
 */
export function expandRRule(parts: RRuleParts, anchor: Date, now: Date): string[] {
  const freq = (parts['FREQ'] ?? '').toUpperCase()
  const stepMs = FREQ_STEP_MS[freq]
  if (stepMs !== undefined) return expandSubDaily(stepMs, parts, anchor, now)
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return []

  const interval = Math.max(1, Math.trunc(Number(parts['INTERVAL'] ?? 1)) || 1)
  const by = readByParts(parts)
  const { maxOccurrences, untilMs } = boundsOf(parts)

  const anchorMid  = midnight(anchor)
  const windowStart = now.getTime() - WINDOW_BEFORE_MS
  const windowEnd   = now.getTime() + WINDOW_AFTER_MS

  const dates = new Set<string>()
  let emitted = 0

  // With no COUNT, occurrences before the window cannot influence what is
  // emitted, so the walk starts at the window instead of at the anchor —
  // otherwise a weekday standup running since 2010 would spend its whole period
  // budget on years nobody is looking at and reach the window empty-handed.
  // A COUNT does have to be tallied from the anchor, but it is finite by
  // definition and bounds the walk on its own.
  const skip = maxOccurrences === Infinity
    ? Math.max(0, Math.floor(periodsBetween(freq, anchor, by, new Date(windowStart)) / interval) * interval)
    : 0

  for (let n = skip; n < skip + MAX_PERIODS; n += interval) {
    const periodStart = periodStartAt(freq, anchor, by, n)
    if (periodStart.getTime() > windowEnd) break
    if (emitted >= maxOccurrences || dates.size >= MAX_OCCURRENCES) break

    const candidates = applySetPos(
      periodCandidates(freq, periodStart, by, anchor).filter(d => passesLimits(d, freq, by)),
      by.bySetPos,
    )
    for (const d of candidates) {
      const ms = d.getTime()
      // Occurrences before DTSTART are not produced at all (RFC 5545 §3.8.5.3),
      // which is what excludes the earlier weekdays of the anchor's own week.
      if (ms < anchorMid.getTime()) continue
      if (ms > untilMs) return [...dates].sort()
      if (emitted >= maxOccurrences) break
      emitted++
      if (ms >= windowStart && ms <= windowEnd) dates.add(localDate(d))
    }
  }

  return [...dates].sort()
}
