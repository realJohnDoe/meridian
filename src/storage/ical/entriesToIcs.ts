// ── Meridian entries → `.ics` — the inverse of `icsToEntries.ts` ────────────
//
// Takes one vault's `Entry[]` (as already loaded in the store — no file I/O of
// its own) and renders a single VCALENDAR. `repeatToRrule.ts` supplies the
// RRULE for a series; this module supplies everything RFC 5545 needs around
// it — VEVENT framing, UID/DTSTAMP, DTSTART/DTEND, and the EXDATE/RECURRENCE-ID
// pair that stands in for Meridian's `instances:` overrides.
//
// Two deliberate simplifications, both product decisions rather than
// technical limits:
//
//  - **`after_completion` series are omitted entirely**, not approximated.
//    RFC 5545 has no equivalent (the next date depends on when the last one
//    was completed, not the calendar), and none of the possible stand-ins —
//    a single dated event, or the currently-projected slot — is what the
//    series actually means.
//  - **Every date/time is emitted floating** (no `TZID`, no trailing `Z`) —
//    Meridian's own times are local wall clock with no zone attached, so
//    floating is what they already mean; a `Z`-suffixed or `TZID`-qualified
//    value would be asserting a zone the data never had.
//
// Per-occurrence overrides are also richer than a `RECURRENCE-ID` VEVENT can
// hold — only date/time/duration/title survive; participants, priority, done
// state and unknown `extra` keys do not, matching how `icsToEntries.ts`
// already only reads a handful of ATTENDEE/ORGANIZER-shaped fields back in.

import type { Entry, StoreItem, StoreOcc, StoreSeries } from '@/types'
import { isSeries, isStandaloneOcc } from '@/types'
import { parseDateTime, parseDuration, fmtISO } from '@/model'
import { repeatToRrule } from './repeatToRrule'

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYYMMDD` from a `YYYY-MM-DD` date string. */
function icsDate(date: string): string {
  return date.replace(/-/g, '')
}

/** `YYYYMMDDTHHMMSS` (no zone) from Meridian's `date` + `time` strings. */
function icsFloatingDateTime(date: string, time: string): string {
  const [h = '0', m = '0'] = time.split(':')
  return `${icsDate(date)}T${pad(+h)}${pad(+m)}00`
}

/**
 * One `NAME:VALUE` (or `NAME;VALUE=DATE:VALUE`) content line for a date/time
 * property — `DTSTART`, `DTEND`, `EXDATE`, `RECURRENCE-ID`. `time === null` is
 * an all-day value; anything else carries a floating time.
 */
function dtLine(name: string, date: string, time: string | null): string {
  return time === null
    ? `${name};VALUE=DATE:${icsDate(date)}`
    : `${name}:${icsFloatingDateTime(date, time)}`
}

/** `YYYYMMDDTHHMMSSZ` for the export's own DTSTAMP — a creation instant, not user data, so UTC is correct even though everything else is floating. */
function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T`
    + `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Escape a TEXT value per RFC 5545 §3.3.11 — the inverse of `icsParse.ts`'s `unescapeText`. */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

/**
 * Fold one content line to RFC 5545's 75-octet limit, continuation lines
 * prefixed with a single space.
 *
 * Folds on UTF-16 code units rather than UTF-8 octets — simpler, and correct
 * for the vast majority of titles (plain ASCII/Latin text, where the two
 * coincide); it only under-folds relative to the RFC for lines dense with
 * multi-byte characters, which real-world parsers tolerate fine (this
 * exporter's own `icsParse.ts` never required folding in the first place).
 * Never splits a surrogate pair, so it can't corrupt an astral character.
 */
function foldLine(line: string): string {
  const LIMIT = 75
  if (line.length <= LIMIT) return line
  const chunks: string[] = []
  let i = 0
  let first = true
  while (i < line.length) {
    const room = first ? LIMIT : LIMIT - 1 // continuation lines' leading space counts toward the limit
    let end = Math.min(i + room, line.length)
    if (end < line.length) {
      const code = line.charCodeAt(end - 1)
      if (code >= 0xd800 && code <= 0xdbff) end -= 1 // don't split a surrogate pair
    }
    chunks.push(line.slice(i, end))
    i = end
    first = false
  }
  return chunks.join('\r\n ')
}

// ── Duration → end date/time ─────────────────────────────────────────────────

/**
 * The end of a span that starts at `date`/`time` and lasts `duration`
 * (Meridian's own duration spelling — see `model/duration.ts`), or `null` for
 * a duration that doesn't parse.
 *
 * Computed by calendar arithmetic on a local `Date` (months/years add
 * calendar units, not a fixed number of days) and read back through the same
 * local accessors — never through UTC, which would reintroduce the zone
 * offset floating times are deliberately free of.
 */
function addDuration(date: string, time: string | null, duration: string): { date: string; time: string | null } | null {
  const p = parseDuration(duration)
  if (!p) return null
  const start = parseDateTime(date, time)
  if (!start) return null

  if (time === null) {
    const days = p.unit === 'days' ? p.n
      : p.unit === 'weeks' ? p.n * 7
      : p.unit === 'months' ? p.n * 30
      : p.unit === 'years' ? p.n * 365
      : null
    if (days === null || days <= 0) return null
    const d = new Date(start)
    d.setDate(d.getDate() + days)
    return { date: fmtISO(d), time: null }
  }

  const d = new Date(start)
  switch (p.unit) {
    case 'minutes': d.setMinutes(d.getMinutes() + p.n); break
    case 'hours':   d.setHours(d.getHours() + p.n); break
    case 'days':    d.setDate(d.getDate() + p.n); break
    case 'weeks':   d.setDate(d.getDate() + p.n * 7); break
    case 'months':  d.setMonth(d.getMonth() + p.n); break
    case 'years':   d.setFullYear(d.getFullYear() + p.n); break
  }
  return { date: fmtISO(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

// ── Override id → the generated slot it replaces ─────────────────────────────

/**
 * Recover the original generated occurrence an override child replaces, from
 * its own `id` — the exact inverse of `stableOccId` (`model/expansion.ts`),
 * which mints a series override's id as `occ:${ownerId}|${date}|${time}` at
 * the moment it's created.
 *
 * That id is never updated when the occurrence is later moved (only its
 * `date`/`time` fields change — see `applySingle` in `model/storeOps.ts`), so
 * it keeps naming the *original* slot for as long as the override exists.
 * That's exactly what `RECURRENCE-ID` needs to name, and exactly what
 * `icsToEntries.ts`'s `overrideInstances` reconstructs in the opposite
 * direction from a moved `RECURRENCE-ID` VEVENT.
 *
 * `null` for an override with no such id — e.g. one added via edit scope
 * `add`, which was never a generated occurrence to begin with (`upsertOverride`
 * mints those with a fresh UUID). The caller falls back to the override's own
 * date, which is the best a `RECURRENCE-ID` can do for an occurrence RFC 5545
 * has no better vocabulary for.
 */
function originalSlot(id: string, ownerId: string): { date: string; time: string | null } | null {
  const prefix = `occ:${ownerId}|`
  if (!id.startsWith(prefix)) return null
  const rest = id.slice(prefix.length)
  const sep = rest.indexOf('|')
  if (sep === -1) return null
  const date = rest.slice(0, sep)
  const time = rest.slice(sep + 1)
  return date.length > 0 ? { date, time: time.length > 0 ? time : null } : null
}

// ── VEVENT emission ───────────────────────────────────────────────────────────

function uidFor(id: string): string {
  return `${id}@meridian`
}

function emitDuration(push: (line: string) => void, date: string, time: string | null, duration: string | undefined): void {
  if (!duration) return
  const end = addDuration(date, time, duration)
  if (end) push(dtLine('DTEND', end.date, end.time))
}

/** The `RECURRENCE-ID` VEVENT for one non-excluded override child of a series. */
function emitOverride(
  push: (line: string) => void,
  entry: Entry,
  series: StoreSeries,
  uid: string,
  stamp: string,
  ov: StoreOcc,
): void {
  if (!ov.date) return
  const slot = originalSlot(ov.id, series.id) ?? { date: ov.date, time: ov.time }
  const title = typeof ov.metadata.extra?.['title'] === 'string' ? ov.metadata.extra['title'] : entry.root.title

  push('BEGIN:VEVENT')
  push(`UID:${escapeText(uid)}`)
  push(`DTSTAMP:${stamp}`)
  push(dtLine('RECURRENCE-ID', slot.date, slot.time))
  push(dtLine('DTSTART', ov.date, ov.time))
  emitDuration(push, ov.date, ov.time, ov.metadata.duration ?? series.metadata.duration)
  push(`SUMMARY:${escapeText(title || 'Untitled event')}`)
  push('END:VEVENT')
}

/** The master VEVENT for a series or a top-level standalone occurrence, plus its overrides. */
function emitMaster(
  push: (line: string) => void,
  entry: Entry,
  item: StoreSeries | StoreOcc,
  overrides: StoreOcc[],
  stamp: string,
): void {
  if (!item.date) return // undated — nothing for an RRULE-shaped format to place
  const uid = uidFor(item.id)
  const title = entry.root.title || 'Untitled event'

  push('BEGIN:VEVENT')
  push(`UID:${escapeText(uid)}`)
  push(`DTSTAMP:${stamp}`)
  push(dtLine('DTSTART', item.date, item.time))
  emitDuration(push, item.date, item.time, item.metadata.duration)
  push(`SUMMARY:${escapeText(title)}`)
  if (entry.root.body) push(`DESCRIPTION:${escapeText(entry.root.body)}`)

  if (isSeries(item)) {
    const anchor = parseDateTime(item.date, item.time)
    const rrule = anchor ? repeatToRrule(item.repeat, anchor) : null
    if (rrule) push(`RRULE:${rrule}`)
    for (const ov of overrides) {
      if (ov.excluded && ov.date) push(dtLine('EXDATE', ov.date, ov.time))
    }
  }
  push('END:VEVENT')

  if (isSeries(item)) {
    for (const ov of overrides) {
      if (!ov.excluded) emitOverride(push, entry, item, uid, stamp, ov)
    }
  }
}

/** Series override children of `entry`, grouped by the series `id` (`ownerId`) they belong to. */
function overridesBySeries(items: readonly StoreItem[]): Map<string, StoreOcc[]> {
  const out = new Map<string, StoreOcc[]>()
  for (const item of items) {
    if (isSeries(item) || !item.ownerId) continue
    const list = out.get(item.ownerId)
    if (list) list.push(item)
    else out.set(item.ownerId, [item])
  }
  return out
}

/** All entries in one file, emitted as one VEVENT (plus overrides) per series/standalone item. */
function emitEntry(push: (line: string) => void, entry: Entry, stamp: string): void {
  const byOwner = overridesBySeries(entry.items)
  for (const item of entry.items) {
    if (isSeries(item)) {
      // No RRULE says "N after you tick it off" — see the header comment.
      if (item.repeat.type === 'after_completion') continue
      emitMaster(push, entry, item, byOwner.get(item.id) ?? [], stamp)
    } else if (isStandaloneOcc(item)) {
      emitMaster(push, entry, item, [], stamp)
    }
  }
}

/**
 * Render one vault's entries as a `.ics` document.
 *
 * `now` is injectable purely so DTSTAMP is deterministic in tests; production
 * callers leave it at the actual export time.
 */
export function entriesToIcs(entries: Entry[], now: Date = new Date()): string {
  const stamp = utcStamp(now)
  const lines: string[] = []
  const push = (line: string): void => { lines.push(foldLine(line)) }

  push('BEGIN:VCALENDAR')
  push('VERSION:2.0')
  push('PRODID:-//Meridian//Meridian Calendar Export//EN')
  push('CALSCALE:GREGORIAN')
  for (const entry of entries) emitEntry(push, entry, stamp)
  push('END:VCALENDAR')

  return lines.join('\r\n') + '\r\n'
}
