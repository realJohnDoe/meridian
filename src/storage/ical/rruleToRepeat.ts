// ── RRULE → Meridian `Repeat`, with a bounded-expansion fallback ─────────────
//
// RFC 5545's recurrence grammar is strictly larger than Meridian's `Repeat`.
// Rather than approximate the rules that don't fit — which produces a series
// that looks right and silently sits on the wrong days — anything
// unrepresentable is expanded here into explicit dated occurrences over a
// bounded window. Honest, bounded, and it needs no change to the expansion
// engine.
//
// The mapping only claims a rule when the two engines provably agree on the
// dates. Where that needs an argument (weekly with an interval, monthly by
// weekday), the argument is written out at the check.

import type { Repeat, Weekday } from '@/types'
import { parseIcsDateTime, localDate } from './icsDateTime'

/** How far a fallback expansion reaches, relative to today. */
const WINDOW_BEFORE_MS = 365 * 86_400_000
const WINDOW_AFTER_MS  = 2 * 365 * 86_400_000
/**
 * A hard stop on the fallback, independent of the window. Sub-daily rules
 * (`FREQ=HOURLY`) would otherwise emit tens of thousands of occurrences for one
 * event, and a feed can hold hundreds of events.
 */
const MAX_FALLBACK_OCCURRENCES = 750

/**
 * Either a rule the engine can carry, or the dates it could not.
 *
 * `dates` are `YYYY-MM-DD` in the viewer's local zone, matching the `date` field
 * the caller writes into `instances:`. `null` means the RRULE was unusable
 * altogether and the event should stand as a single occurrence.
 */
export type RepeatMapping =
  | { kind: 'repeat'; repeat: Repeat }
  | { kind: 'dates'; dates: string[] }

type RRuleParts = Record<string, string>

const WEEKDAY_BY_ICS: Record<string, Weekday> = {
  SU: 'su', MO: 'mo', TU: 'tu', WE: 'we', TH: 'th', FR: 'fr', SA: 'sa',
}
const JS_DAY_BY_ICS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

/** `FREQ=WEEKLY;BYDAY=MO,WE` → `{ FREQ: 'WEEKLY', BYDAY: 'MO,WE' }`, keys upper-cased. */
export function parseRRule(value: string): RRuleParts {
  const parts: RRuleParts = {}
  for (const chunk of value.split(';')) {
    const eq = chunk.indexOf('=')
    if (eq === -1) continue
    const key = chunk.slice(0, eq).trim().toUpperCase()
    if (key.length > 0) parts[key] = chunk.slice(eq + 1).trim()
  }
  return parts
}

/** `2FR` → `{ ordinal: 2, day: 'FR' }`; `FR` → `{ ordinal: undefined, day: 'FR' }`. */
function parseByDay(token: string): { ordinal?: number; day: string } | null {
  const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(token.trim())
  if (!m?.[2]) return null
  const day = m[2].toUpperCase()
  return m[1] ? { ordinal: Number(m[1]), day } : { day }
}

function byDayList(parts: RRuleParts): Array<{ ordinal?: number; day: string }> | null {
  const raw = parts['BYDAY']
  if (!raw) return []
  const out: Array<{ ordinal?: number; day: string }> = []
  for (const token of raw.split(',')) {
    const parsed = parseByDay(token)
    if (!parsed) return null // an unreadable BYDAY must not be silently dropped
    out.push(parsed)
  }
  return out
}

function intList(raw: string | undefined): number[] | null {
  if (!raw) return []
  const out: number[] = []
  for (const token of raw.split(',')) {
    const n = Number(token.trim())
    if (!Number.isInteger(n)) return null
    out.push(n)
  }
  return out
}

/** The `end:` block for a COUNT or UNTIL, if the rule has one. */
function endOf(parts: RRuleParts): Repeat['end'] | undefined {
  const count = parts['COUNT']
  if (count) {
    const n = Number(count)
    if (Number.isInteger(n) && n > 0) return { type: 'count', occurrences: n }
  }
  const until = parts['UNTIL']
  if (until) {
    // UNTIL is UTC whenever it carries a time, so it goes through the same
    // conversion as DTSTART — an event ending 23:59:59Z ends the *next* local
    // day east of Greenwich, and clipping the series a day early is a visible
    // wrong answer.
    const instant = parseIcsDateTime(until)
    if (instant) return { type: 'until', date: localDate(instant.when) }
  }
  return undefined
}

/** Parts that carry real meaning and that Meridian has no way to express. */
const UNSUPPORTED_PARTS = ['BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYEASTER']

/**
 * Map an RRULE onto a `Repeat` when the two engines agree, otherwise expand it.
 *
 * `anchor` is the event's DTSTART as a local `Date` — needed both as the
 * expansion seed and to judge whether a rule is representable, since several of
 * Meridian's shapes are defined relative to the anchor rather than absolutely.
 */
export function rruleToRepeat(rrule: string, anchor: Date, now: Date = new Date()): RepeatMapping {
  const parts = parseRRule(rrule)
  const repeat = tryRepresent(parts, anchor)
  return repeat ? { kind: 'repeat', repeat } : { kind: 'dates', dates: expandRRule(parts, anchor, now) }
}

/**
 * The representability decision. Returns `null` for "expand it instead" — never
 * a close-enough rule.
 */
function tryRepresent(parts: RRuleParts, anchor: Date): Repeat | null {
  const freqRaw = (parts['FREQ'] ?? '').toUpperCase()
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freqRaw)) return null
  const freq = freqRaw.toLowerCase() as 'daily' | 'weekly' | 'monthly' | 'yearly'

  if (UNSUPPORTED_PARTS.some(p => parts[p] !== undefined)) return null

  const interval = parts['INTERVAL'] === undefined ? 1 : Number(parts['INTERVAL'])
  if (!Number.isInteger(interval) || interval < 1) return null

  const byDay = byDayList(parts)
  if (!byDay) return null
  const byMonthDay = intList(parts['BYMONTHDAY'])
  if (!byMonthDay) return null
  const byMonth = intList(parts['BYMONTH'])
  if (!byMonth) return null
  const bySetPos = intList(parts['BYSETPOS'])
  if (!bySetPos) return null

  const end = endOf(parts)
  // A COUNT/UNTIL the parser could not read must not become an endless series.
  if (parts['COUNT'] !== undefined && end?.type !== 'count') return null
  if (parts['UNTIL'] !== undefined && end?.type !== 'until') return null

  const base = { type: 'schedule' as const, freq, ...(interval > 1 ? { interval } : {}), ...(end ? { end } : {}) }

  if (freq === 'daily') {
    // Meridian's daily branch emits exactly one date per period; a BYDAY or
    // BYMONTHDAY filter on top of it has no representation.
    return byDay.length === 0 && byMonthDay.length === 0 && bySetPos.length === 0 && byMonth.length === 0
      ? base
      : null
  }

  if (freq === 'weekly') {
    if (byMonthDay.length > 0 || bySetPos.length > 0 || byMonth.length > 0) return null
    if (byDay.length === 0) return base
    if (byDay.some(d => d.ordinal !== undefined)) return null // `2FR` is meaningless weekly
    if (!weeklyWindowsAgree(byDay, parts, anchor, interval)) return null
    return { ...base, byweekday: byDay.map(d => WEEKDAY_BY_ICS[d.day]).filter((d): d is Weekday => !!d) }
  }

  if (freq === 'monthly') {
    if (byMonth.length > 0) return null
    if (byDay.length === 0) {
      // Plain "same day-of-month", optionally listing that day explicitly.
      // Negative days (`-1` = last day of the month) have no representation:
      // Meridian's bymonthday is a literal day number.
      if (bySetPos.length > 0) return null
      if (byMonthDay.length === 0) return base
      if (byMonthDay.some(d => d < 1 || d > 31)) return null
      return { ...base, bymonthday: byMonthDay }
    }
    if (byMonthDay.length > 0) return null

    // Meridian's monthly-by-weekday takes ONE position applied to the combined
    // candidate list of every named weekday — which covers both spellings the
    // RFC allows: `BYDAY=2FR` (ordinal on the day) and
    // `BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1` (position over the set).
    const ordinals = new Set(byDay.map(d => d.ordinal).filter((o): o is number => o !== undefined))
    if (ordinals.size > 0) {
      if (bySetPos.length > 0 || ordinals.size > 1 || byDay.some(d => d.ordinal === undefined)) return null
      const [pos] = [...ordinals]
      if (pos === undefined || pos === 0) return null
      // Only the last-of-month negative is expressible; `-2FR` is not.
      if (pos < -1) return null
      return { ...base, byweekday: byDay.map(d => WEEKDAY_BY_ICS[d.day]).filter((d): d is Weekday => !!d), bysetpos: pos }
    }
    if (bySetPos.length !== 1) return null
    const pos = bySetPos[0]
    if (pos === undefined || pos === 0 || pos < -1) return null
    return { ...base, byweekday: byDay.map(d => WEEKDAY_BY_ICS[d.day]).filter((d): d is Weekday => !!d), bysetpos: pos }
  }

  // Yearly: the engine repeats the anchor's own month and day, and reads no
  // BY* part at all. So the rule is only representable when its BY* parts say
  // exactly that — otherwise `BYMONTH=3;BYDAY=2SU` would come out as "the
  // anchor's date, annually", which is a different day most years.
  if (byDay.length > 0 || bySetPos.length > 0) return null
  if (byMonth.length > 1 || byMonthDay.length > 1) return null
  if (byMonth.length === 1 && byMonth[0] !== anchor.getMonth() + 1) return null
  if (byMonthDay.length === 1 && byMonthDay[0] !== anchor.getDate()) return null
  return base
}

/**
 * Whether Meridian's weekly windows select the same dates as the RFC's.
 *
 * Meridian anchors each 7-day window on the *anchor's* weekday; the RFC anchors
 * it on `WKST` (Monday by default). With `INTERVAL: 1` the windows tile
 * identically however the boundary is drawn — every window holds each weekday
 * exactly once — so any BYDAY set agrees.
 *
 * With `INTERVAL >= 2` the windows no longer tile, and the two disagree for any
 * named weekday that falls *before* the anchor's weekday inside the RFC week:
 * the RFC skips it in the first period and picks it up in the next, while
 * Meridian counts it forward into the current one — landing a week apart from
 * then on. Those go to bounded expansion instead.
 */
function weeklyWindowsAgree(
  byDay: Array<{ day: string }>, parts: RRuleParts, anchor: Date, interval: number,
): boolean {
  if (interval === 1) return true
  const wkst = JS_DAY_BY_ICS[(parts['WKST'] ?? 'MO').toUpperCase()] ?? 1
  const anchorPos = (anchor.getDay() - wkst + 7) % 7
  return byDay.every(d => {
    const dow = JS_DAY_BY_ICS[d.day]
    return dow !== undefined && (dow - wkst + 7) % 7 >= anchorPos
  })
}

// ── Bounded expansion ────────────────────────────────────────────────────────

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
  for (let step = 0; step < 60_000 && emitted < maxOccurrences && dates.size < MAX_FALLBACK_OCCURRENCES; step++) {
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
 * It only ever runs for rules `tryRepresent` declined, and it emits explicit
 * dates rather than a rule — so where it is imprecise, the imprecision is
 * visible on the calendar instead of compounding forward forever. `BYYEARDAY`
 * and `BYWEEKNO` are honoured as limits only, never as expansions; no mainstream
 * exporter emits either.
 *
 * Counting starts at the anchor, not at the window, because `COUNT` counts every
 * occurrence the rule ever produced — a series that ran out before the window
 * opened must come back empty, not full.
 *
 * An empty result means "no recurrence": an unreadable or unsupported `FREQ`,
 * or a series that ended before the window. The caller renders a single
 * occurrence.
 */
function expandRRule(parts: RRuleParts, anchor: Date, now: Date): string[] {
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
    if (emitted >= maxOccurrences || dates.size >= MAX_FALLBACK_OCCURRENCES) break

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
