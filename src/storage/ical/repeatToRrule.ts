// ── Meridian `Repeat` → RRULE, the inverse of `rruleToRepeat` ────────────────
//
// The mapping the other way round has an easy job and a hard one. The easy job
// is spelling: `freq: 'weekly'` is `FREQ=WEEKLY`. The hard one is that
// `Repeat` is a *looser* type than the engine that reads it — several fields
// are silently ignored depending on which other fields are set, because
// `matchesInPeriod` (`model/expansion.ts`) picks one branch per frequency and
// only reads the fields that branch names.
//
// A faithful RRULE therefore has to emit what the engine *does*, not what the
// object *says*. `{ freq: 'monthly', byweekday: ['fr'] }` with no `bysetpos`
// does not mean "every Friday" — the monthly branch requires both, so it falls
// through to "the anchor's day-of-month" and the `byweekday` is dead data.
// Emitting `BYDAY=FR` for it would produce an RRULE that means something the
// file never meant. Each drop below is commented with the branch that ignores
// the field.
//
// `anchor` is the series' own start date — the DTSTART an emitted VEVENT would
// carry. It is needed for the same reason `rruleToRepeat` needs it: several of
// Meridian's shapes are defined relative to the anchor rather than absolutely,
// so the rule alone does not determine the dates.
//
// This module maps the recurrence rule and nothing else. Turning one into an
// actual `.ics` — VEVENT emission, `instances:` as RDATE/EXDATE, the DTSTART
// value-type pairing UNTIL is subject to — is a separate concern.

import type { Repeat, Weekday } from '@/types'

const ICS_BY_WEEKDAY: Record<Weekday, string> = {
  su: 'SU', mo: 'MO', tu: 'TU', we: 'WE', th: 'TH', fr: 'FR', sa: 'SA',
}

/** `Date.getDay()` index → Meridian weekday, so the anchor can name its own. */
const WEEKDAY_BY_JS_DAY: Weekday[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYYMMDD` from a `YYYY-MM-DD` date string. */
function icsDate(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  return m ? `${m[1]}${m[2]}${m[3]}` : null
}

/**
 * `YYYYMMDDTHHMMSSZ` for the instant `date` + `time` names in the viewer's
 * local zone.
 *
 * UTC rather than a floating value because that is what `UNTIL` means when it
 * carries a time (RFC 5545 §3.3.10), and it is what `rruleToRepeat`'s `endOf`
 * reads back — the two have to agree on the instant or a round-trip moves the
 * end of the series by the zone offset.
 */
function icsUtcStamp(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const t = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  if (!d || !t) return null
  const at = new Date(+d[1]!, +d[2]! - 1, +d[3]!, +t[1]!, +t[2]!, 0, 0)
  if (Number.isNaN(at.getTime())) return null
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T`
    + `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
}

/** `COUNT=` / `UNTIL=` for a repeat's end block, or `null` when it bounds nothing. */
function endPart(end: Extract<Repeat, { type: 'schedule' }>['end']): string | null {
  if (!end) return null
  if (end.type === 'count') {
    // Meridian counts the anchor as occurrence #1 and generates `occurrences - 1`
    // more; `COUNT` counts DTSTART the same way, so the number carries across
    // unchanged. A non-positive count still yields the anchor alone, which is
    // `COUNT=1` — `COUNT=0` is not a legal value.
    return `COUNT=${Math.max(1, Math.trunc(end.occurrences))}`
  }
  // An `until` with no date bounds nothing at all (`generateScheduledDates`
  // falls back to the query window), so it must not become an `UNTIL` that
  // clips the series somewhere.
  if (!end.date) return null
  // `date` alone is inclusive of the whole day, which is exactly what a
  // date-valued `UNTIL` means; `date` + `time` names an instant, which needs
  // the UTC form.
  const stamp = end.time ? icsUtcStamp(end.date, end.time) : icsDate(end.date)
  return stamp ? `UNTIL=${stamp}` : null
}

/**
 * The RRULE that produces the same dates as `repeat` anchored at `anchor`, or
 * `null` for a repeat that has no RRULE equivalent.
 *
 * `null` means "this rule cannot be written as an RRULE", not "nothing
 * recurs" — an `after_completion` repeat is a real, useful rule that RFC 5545
 * simply cannot express, since the next date depends on when the last one was
 * ticked off rather than on the calendar.
 */
export function repeatToRrule(repeat: Repeat, anchor: Date): string | null {
  // `after_completion` re-anchors on each completion. There is no RRULE for
  // "three days after you tick it", and approximating it with a fixed interval
  // would drift the moment the user is a day late.
  if (repeat.type !== 'schedule') return null

  const { freq, byweekday, bymonthday, bysetpos, interval = 1, end } = repeat
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) return null
  // `interval` reaches here from YAML through an unchecked cast, so it can be
  // anything. The engine's cursor never advances on a non-positive interval —
  // there is no RRULE for that, and `INTERVAL=0` is not a legal value.
  if (!Number.isInteger(interval) || interval < 1) return null

  const days = (byweekday ?? [])
    .map(d => ICS_BY_WEEKDAY[d.toLowerCase() as Weekday])
    .filter((d): d is string => !!d)

  const parts: string[] = [`FREQ=${freq.toUpperCase()}`]
  if (interval > 1) parts.push(`INTERVAL=${interval}`)

  if (freq === 'daily') {
    // At DAILY both engines read these as limits on a single-day period, not
    // as expansions — RFC 5545 §3.3.10's table and the daily arm of
    // `matchesInPeriod` say the same thing — so they carry across verbatim.
    if (days.length > 0) parts.push(`BYDAY=${days.join(',')}`)
    if (bymonthday?.length) parts.push(`BYMONTHDAY=${bymonthday.join(',')}`)
    // `bysetpos` is read only by the monthly arm; dropped.
  } else if (freq === 'weekly') {
    // The weekly arm reads `byweekday` and nothing else.
    if (days.length > 0) {
      parts.push(`BYDAY=${days.join(',')}`)
      // Meridian's 7-day windows start on the ANCHOR's weekday; the RFC's start
      // on `WKST`, which defaults to Monday. With `interval: 1` every window
      // holds each weekday exactly once however the boundary is drawn, so the
      // two tile identically and `WKST` cannot change a date. From `interval: 2`
      // up the windows no longer tile and the boundary decides which fortnight
      // a weekday lands in, so the anchor's weekday has to be stated —
      // `expansion.ts` records this as the exact `WKST` that reproduces it.
      if (interval > 1) parts.push(`WKST=${ICS_BY_WEEKDAY[WEEKDAY_BY_JS_DAY[anchor.getDay()]!]}`)
    }
  } else if (freq === 'monthly') {
    if (bymonthday?.length) {
      // The monthly arm checks `bymonthday` first and returns, so a `byweekday`
      // alongside it never runs. Negative days count back from the month's end
      // in both engines (`resolveMonthDay`, and the RFC's own `-1` = last).
      parts.push(`BYMONTHDAY=${bymonthday.join(',')}`)
    } else if (days.length > 0 && bysetpos !== undefined) {
      // Meridian applies ONE position to the combined candidate list of every
      // named weekday, which is the `BYDAY=...;BYSETPOS=n` spelling. The
      // equivalent `BYDAY=2FR` spelling exists only for a single weekday, so
      // this one form covers every case the engine can express.
      if (bysetpos === 0) return null // no such position; the engine emits nothing
      parts.push(`BYDAY=${days.join(',')}`, `BYSETPOS=${bysetpos}`)
    }
    // Neither: the monthly arm repeats the anchor's own day-of-month, which
    // DTSTART already carries. A `byweekday` with no `bysetpos` lands here and
    // is dead data — see the header.
  }
  // YEARLY reads no BY* part at all: the arm repeats the anchor's month and
  // day, so DTSTART carries the whole rule and anything else on the object is
  // dead data. `FREQ=YEARLY` alone means precisely that.

  const bound = endPart(end)
  if (bound) parts.push(bound)

  return parts.join(';')
}
