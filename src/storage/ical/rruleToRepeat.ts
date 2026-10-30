// ── RRULE → Meridian `Repeat` ────────────────────────────────────────────────
//
// RFC 5545's recurrence grammar is strictly larger than Meridian's `Repeat`.
// Rather than approximate the rules that don't fit — which produces a series
// that looks right and silently sits on the wrong days — anything
// unrepresentable is reported as `unsupported` and the caller leaves the event
// out. The RFC walk the round-trip tests compare against is `rruleOracle.ts`.
//
// The mapping only claims a rule when the two engines provably agree on the
// dates. Where that needs an argument (weekly with an interval, monthly by
// weekday), the argument is written out at the check.

import type { Repeat, Weekday } from '@/types'
import { parseIcsDateTime, localDate, localTime } from './icsDateTime'

/** Either a rule the engine can carry, or a note that it cannot. */
export type RepeatMapping =
  | { kind: 'repeat'; repeat: Repeat }
  | { kind: 'unsupported' }

export type RRuleParts = Record<string, string>

const WEEKDAY_BY_ICS: Record<string, Weekday> = {
  SU: 'su', MO: 'mo', TU: 'tu', WE: 'we', TH: 'th', FR: 'fr', SA: 'sa',
}
export const JS_DAY_BY_ICS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

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

export function byDayList(parts: RRuleParts): Array<{ ordinal?: number; day: string }> | null {
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

/** The BYDAY tokens as Meridian weekdays, dropping any the map has no name for. */
function weekdays(byDay: Array<{ day: string }>): Weekday[] {
  return byDay.map(d => WEEKDAY_BY_ICS[d.day]).filter((d): d is Weekday => !!d)
}

/** The rule's own `WKST` as a Meridian weekday — Monday when it names none (RFC 5545 §3.3.10). */
function rfcWeekStart(parts: RRuleParts): Weekday {
  return WEEKDAY_BY_ICS[(parts['WKST'] ?? 'MO').toUpperCase()] ?? 'mo'
}

export function intList(raw: string | undefined): number[] | null {
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
    // wrong answer. When it does carry a time, that clock time is kept too —
    // a date-only UNTIL still bounds the whole day, but one with a time bounds
    // that exact instant.
    const instant = parseIcsDateTime(until)
    if (instant) {
      return instant.allDay
        ? { type: 'until', date: localDate(instant.when) }
        : { type: 'until', date: localDate(instant.when), time: localTime(instant.when) }
    }
  }
  return undefined
}

/** Parts that carry real meaning and that Meridian has no way to express. */
const UNSUPPORTED_PARTS = ['BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYEASTER']

/** The months a yearly rule spans when it names none but does name a day. */
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/**
 * Map an RRULE onto a `Repeat` when the two engines agree.
 *
 * `anchor` is the event's DTSTART as a local `Date` — needed to judge whether a
 * rule is representable, since several of Meridian's shapes are defined
 * relative to the anchor rather than absolutely.
 */
export function rruleToRepeat(rrule: string, anchor: Date): RepeatMapping {
  const repeat = tryRepresent(parseRRule(rrule), anchor)
  return repeat ? { kind: 'repeat', repeat } : { kind: 'unsupported' }
}

/**
 * The representability decision. Returns `null` for "unsupported" — never
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

  // `bymonth` is a *set* of calendar months to both engines, so the order a
  // feed happens to list them in carries no meaning — normalising here keeps
  // the value stable across an import/export/import cycle. A month outside
  // 1–12 is not a rule either engine can act on, so it goes to expansion
  // rather than being silently dropped from the set.
  if (byMonth.some(m => m < 1 || m > 12)) return null
  const months = [...new Set(byMonth)].sort((a, b) => a - b)
  const monthPart = months.length > 0 ? { bymonth: months } : {}

  const end = endOf(parts)
  // A COUNT/UNTIL the parser could not read must not become an endless series.
  if (parts['COUNT'] !== undefined && end?.type !== 'count') return null
  if (parts['UNTIL'] !== undefined && end?.type !== 'until') return null

  const base = { type: 'schedule' as const, freq, ...(interval > 1 ? { interval } : {}), ...(end ? { end } : {}) }

  if (freq === 'daily') {
    // BYDAY, BYMONTHDAY and BYMONTH are all *limits* at DAILY, not expansions
    // (RFC 5545 §3.3.10): a daily period is a single day, so naming days
    // inside it can only narrow it. The engine's daily arm reads them exactly
    // that way — see `matchesInPeriod`'s `passesWeekday && passesMonthday` in
    // model/expansion.ts — so all three carry across.
    //
    // BYSETPOS does not: it picks from a period's candidate list, a daily
    // period holds one day, and the engine's daily arm ignores the field
    // outright. A rule carrying one still goes to expansion.
    if (bySetPos.length > 0) return null
    // An ordinal is only meaningful at MONTHLY/YEARLY, and the daily limit
    // reads the bare weekday; claiming `2FR` here would drop the `2`.
    if (byDay.some(d => d.ordinal !== undefined)) return null
    if (byMonthDay.some(d => d === 0 || d < -31 || d > 31)) return null
    return {
      ...base, ...monthPart,
      ...(byDay.length > 0 ? { byweekday: weekdays(byDay) } : {}),
      ...(byMonthDay.length > 0 ? { bymonthday: byMonthDay } : {}),
    }
  }

  if (freq === 'weekly') {
    if (byMonthDay.length > 0 || bySetPos.length > 0) return null
    if (byDay.length === 0) return { ...base, ...monthPart }
    if (byDay.some(d => d.ordinal !== undefined)) return null // `2FR` is meaningless weekly
    // Where the windows disagree, state which week the rule means instead of
    // giving up on it: `wkst` (#1010) opens the engine's windows on the RFC's
    // own week start rather than the anchor's weekday, and that boundary *is*
    // the whole of the disagreement — see `weekOrigin` in model/expansion.ts.
    //
    // Omitted where they already agree, which includes every `interval: 1`
    // rule: `wkst` cannot change a date there, and a field that means nothing
    // is not worth writing into someone's file.
    //
    // BYMONTH limits which of the selected days survive; it cannot move the
    // 7-day windows themselves, so it has no bearing on either branch.
    const week = weeklyWindowsAgree(byDay, parts, anchor, interval) ? {} : { wkst: rfcWeekStart(parts) }
    return { ...base, ...monthPart, ...week, byweekday: weekdays(byDay) }
  }

  if (freq === 'monthly') {
    if (byDay.length === 0) {
      // Plain "same day-of-month", optionally listing the days explicitly.
      // Negative days carry across as they are written: `resolveMonthDay` in
      // the engine and `monthDaysIn` in the walk below both count back from
      // the end of each month, so `-1` is the last day to either of them. Day
      // 0 does not exist, and a magnitude past 31 names no day in any month.
      if (bySetPos.length > 0) return null
      if (byMonthDay.length === 0) return { ...base, ...monthPart }
      if (byMonthDay.some(d => d === 0 || d < -31 || d > 31)) return null
      return { ...base, ...monthPart, bymonthday: byMonthDay }
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
      // The two spellings coincide only for a single weekday. `BYDAY=1MO,1FR`
      // is the first Monday *and* the first Friday — two dates a month —
      // whereas one `bysetpos` over the pair's combined candidate list picks
      // whichever of them falls earlier, and only that one.
      if (byDay.length > 1) return null
      return { ...base, ...monthPart, byweekday: weekdays(byDay), bysetpos: pos }
    }
    if (bySetPos.length === 0) {
      // "Every Friday of the month". The engine's monthly arm needs a position
      // to read a weekday at all (`monthCandidates` requires `bysetpos`), so
      // it cannot say this as a monthly rule — but at INTERVAL=1 it does not
      // have to: every Friday of every month is every Friday, which is the
      // weekly rule, over exactly the same dates. COUNT and UNTIL bound the
      // same occurrences either way, and BYMONTH is the same limit in both
      // readings.
      //
      // Only at INTERVAL=1. "Every Friday of every other month" is not "every
      // other Friday", so those still expand.
      if (interval > 1) return null
      return { ...base, freq: 'weekly', ...monthPart, byweekday: weekdays(byDay) }
    }
    if (bySetPos.some(p => p === 0)) return null
    const positions = bySetPos.length === 1 ? bySetPos[0]! : bySetPos
    return { ...base, ...monthPart, byweekday: weekdays(byDay), bysetpos: positions }
  }

  // Yearly. The engine expands over the months `bymonth` names and fills each
  // with the same selection a monthly rule would make (`monthCandidates`,
  // `model/expansion.ts`). That covers most of what the RFC's yearly branch
  // does, and the places it doesn't are the declines below.
  const namesADay = byDay.length > 0 || byMonthDay.length > 0

  // With no BYMONTH the engine reads a day-naming part inside the anchor's own
  // month, while §3.3.10 spreads it over all twelve. Stating the twelve makes
  // the two agree; it is a faithful reading of the rule, and a far smaller
  // thing to write into a vault file than the several hundred dates bounded
  // expansion would put in `instances:`. With nothing naming a day, both
  // engines fall back to the anchor's own month and no list is needed.
  const yearMonths = months.length > 0 ? months : namesADay ? ALL_MONTHS : []
  const yearMonthPart = yearMonths.length > 0 ? { bymonth: yearMonths } : {}

  if (!namesADay) {
    // A BYSETPOS with nothing to pick from selects nothing at all, which is
    // not what the engine would do with the rule.
    if (bySetPos.length > 0) return null
    return { ...base, ...yearMonthPart }
  }

  if (byMonthDay.length > 0) {
    // The engine reads `bymonthday` first and treats a `byweekday` beside it
    // as dead data, where the RFC intersects the two. Claim the pair only when
    // BYMONTHDAY stands alone; negatives resolve per month exactly as they do
    // monthly.
    if (byDay.length > 0 || bySetPos.length > 0) return null
    if (byMonthDay.some(d => d === 0 || d < -31 || d > 31)) return null
    return { ...base, ...yearMonthPart, bymonthday: byMonthDay }
  }

  const yearOrdinals = new Set(byDay.map(d => d.ordinal).filter((o): o is number => o !== undefined))
  if (yearOrdinals.size > 0) {
    // `BYMONTH=11;BYDAY=4TH` — §3.3.10 resolves an ordinal BYDAY within each
    // named month when BYMONTH is present, which is exactly the engine's
    // per-month `bysetpos`. Without BYMONTH the same ordinal counts within the
    // *year* ("the 20th Monday"), which the engine has no way to say — and
    // which `expandRRule` gets wrong too, resolving it per month, so the
    // round-trip test would agree with itself rather than with the RFC.
    if (months.length === 0) return null
    if (bySetPos.length > 0 || yearOrdinals.size > 1 || byDay.some(d => d.ordinal === undefined)) return null
    const [pos] = [...yearOrdinals]
    if (pos === undefined || pos === 0) return null
    // As monthly: one ordinal distributes over each named weekday separately,
    // one `bysetpos` picks from their combined list. Equal for one weekday.
    if (byDay.length > 1) return null
    return { ...base, ...yearMonthPart, byweekday: weekdays(byDay), bysetpos: pos }
  }

  // A plain BYDAY with no position is every matching weekday of the named
  // months to the RFC, and dead data to the engine's yearly arm — it would fall
  // through to the anchor's day-of-month. At INTERVAL=1 that is the weekly rule
  // with the same BYMONTH limit, as in the monthly case above; any longer
  // interval skips whole years, which a weekly rule cannot.
  if (bySetPos.length === 0) {
    if (interval > 1) return null
    return { ...base, freq: 'weekly', ...monthPart, byweekday: weekdays(byDay) }
  }
  if (bySetPos.some(p => p === 0)) return null
  // BYSETPOS picks once per *period*, and a yearly period is the whole year;
  // the engine picks once per month. The two coincide only when the year holds
  // a single month. `BYMONTH=3,9;BYDAY=MO;BYSETPOS=1` is the first Monday of
  // March alone to the RFC, and of both months to the engine.
  if (yearMonths.length !== 1) return null
  const yearPositions = bySetPos.length === 1 ? bySetPos[0]! : bySetPos
  return { ...base, ...yearMonthPart, byweekday: weekdays(byDay), bysetpos: yearPositions }
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
 * then on.
 *
 * Disagreement is no longer a refusal — the caller emits `wkst` and the engine
 * reproduces the RFC exactly. This decides only whether the field is *needed*,
 * so that an agreeing rule stays the plainer of the two spellings.
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
