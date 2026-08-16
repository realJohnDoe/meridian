// ── ICS date/time values → the viewer's local wall clock ─────────────────────
//
// **This is the sharpest edge in the iCal import.** `OccurrenceMetadata.timezone`
// is parsed and round-tripped by the model but consumed by nothing — no view, no
// expansion, no comparison reads it — so an imported event that stored its
// original zone there would render at the wrong hour and there would be no code
// path anywhere to fix it.
//
// So the conversion happens *here*, once, at synthesis time: a `TZID=` or `Z`
// timestamp becomes an instant, and the instant is written out as the plain
// local `date`/`time` the viewer's device would show. The temporal engine stays
// untouched and the agenda is right. The original TZID is kept in `extra` for
// the read view, purely as information.
//
// Feeds are re-synthesized from scratch on every refresh, so a device that
// changes timezone picks the new one up on the next refresh rather than
// carrying stale wall-clock times forever.
//
// `VTIMEZONE` blocks are deliberately ignored in favour of `Intl` on the IANA
// id: the browser's own zone database is more current than whatever the
// exporter froze into the feed, and re-implementing VTIMEZONE's RRULE-based
// offset rules would be a second recurrence engine for no gain.

import { serialiseDuration } from '@/model'

/** A DTSTART/DTEND/RECURRENCE-ID value, resolved to an instant. */
export interface IcsInstant {
  /** The moment itself. For an all-day value, local midnight on that date. */
  when: Date
  /** `VALUE=DATE` — a whole-day value that must never grow a `time`. */
  allDay: boolean
  /** The `TZID` the feed named, when it named one. Kept for `extra`. */
  tzid?: string
}

/** `YYYYMMDD` or `YYYYMMDDTHHMMSS` with an optional trailing `Z`. */
const ICS_DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/

interface RawParts {
  year: number; month: number; day: number
  hour: number; minute: number; second: number
  hasTime: boolean; utc: boolean
}

function splitValue(value: string): RawParts | null {
  const m = ICS_DATE_RE.exec(value.trim())
  if (!m) return null
  return {
    year:   Number(m[1]), month: Number(m[2]), day: Number(m[3]),
    hour:   Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0),
    hasTime: m[4] !== undefined,
    utc:     m[7] === 'Z',
  }
}

/**
 * How far `timeZone` is ahead of UTC at the given instant, in milliseconds.
 *
 * Derived by formatting the instant *in* that zone and reading the wall-clock
 * fields back — the only way to reach the browser's zone database, since `Intl`
 * exposes no offset API. `hourCycle: 'h23'` matters: `hour12: false` renders
 * midnight as hour 24 in some ICU builds, which would put the offset a day out.
 */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs))

  const field = (type: string): number => Number(parts.find(p => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    field('year'), field('month') - 1, field('day'),
    field('hour'), field('minute'), field('second'),
  )
  return asUtc - instantMs
}

/**
 * The instant at which a wall-clock reading occurs in `timeZone`.
 *
 * Two passes because the offset depends on the very instant being solved for:
 * the first guess treats the wall time as UTC, the second re-reads the offset at
 * the corrected instant. That second pass is what makes DST transitions come out
 * right — around a spring-forward the naive offset belongs to the wrong side of
 * the jump. Times inside a skipped hour have no instant at all; the two-pass
 * result lands just after the transition, which is what every calendar client
 * does with them.
 */
function wallClockToInstant(p: RawParts, timeZone: string): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const first = guess - zoneOffsetMs(guess, timeZone)
  const second = guess - zoneOffsetMs(first, timeZone)
  return new Date(second)
}

/** Whether `Intl` recognises this zone id — feeds do carry Windows-style and misspelled ones. */
function knownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve one ICS date/time value against its `TZID` parameter.
 *
 * The three forms in the wild:
 *  - `VALUE=DATE` (`20260815`) — an all-day value, no zone, no conversion;
 *  - a `Z`-suffixed UTC timestamp, or one with `TZID=` — resolved to an instant;
 *  - a bare "floating" timestamp with neither — by definition the same wall
 *    clock everywhere, so it is read as local time and left alone.
 *
 * An unrecognised `TZID` degrades to floating rather than failing: the event
 * still lands on the right day at roughly the right hour, which beats dropping
 * it from the calendar entirely.
 */
export function parseIcsDateTime(value: string, tzid?: string): IcsInstant | null {
  const p = splitValue(value)
  if (!p) return null

  if (!p.hasTime) {
    return { when: new Date(p.year, p.month - 1, p.day), allDay: true, ...(tzid ? { tzid } : {}) }
  }
  if (p.utc) {
    return { when: new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)), allDay: false }
  }
  if (tzid && knownTimeZone(tzid)) {
    return { when: wallClockToInstant(p, tzid), allDay: false, tzid }
  }
  return {
    when: new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
    allDay: false,
    ...(tzid ? { tzid } : {}),
  }
}

// ── Rendering into Meridian's plain local fields ─────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD` in the viewer's local zone. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `HH:mm` in the viewer's local zone. */
export function localTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * A Meridian duration string for a span, or undefined when there is nothing
 * worth writing.
 *
 * All-day spans are counted in whole days, and a single-day event gets no
 * duration at all — `1 day` is what the absence already means, and emitting
 * it would put a redundant field on nearly every all-day event in a feed.
 * Sub-day spans prefer whole hours over minutes because that is the form the
 * editor itself writes.
 *
 * Always written in Meridian's own canonical long-form spelling (`"3 days"`,
 * not `"3d"`) via `serialiseDuration` — independent of however compactly ICS
 * itself expresses spans (`PT1H30M`) — so a synthesized feed reads the same
 * as a hand-authored entry instead of exposing an import-specific shorthand.
 */
export function durationBetween(start: Date, end: Date, allDay: boolean): string | undefined {
  const ms = end.getTime() - start.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return undefined

  if (allDay) {
    // DTEND is exclusive for all-day values, so the span is already the day count.
    const days = Math.round(ms / 86_400_000)
    return days >= 2 ? serialiseDuration(days, 'days') : undefined
  }

  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return serialiseDuration(minutes, 'minutes')
  if (minutes % 1440 === 0) return serialiseDuration(minutes / 1440, 'days')
  if (minutes % 60 === 0) return serialiseDuration(minutes / 60, 'hours')
  return serialiseDuration(minutes, 'minutes')
}

/** ISO 8601 duration (`PT1H30M`, `P2D`, `P1W`) → milliseconds; null if unparseable. */
export function parseIsoDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim())
  if (!m) return null
  const [, sign, weeks, days, hours, minutes, seconds] = m
  if (!weeks && !days && !hours && !minutes && !seconds) return null
  const ms =
    Number(weeks   ?? 0) * 604_800_000 +
    Number(days    ?? 0) * 86_400_000 +
    Number(hours   ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1_000
  return sign === '-' ? -ms : ms
}
