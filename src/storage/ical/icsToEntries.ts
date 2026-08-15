// ── VEVENT → Meridian markdown ───────────────────────────────────────────────
//
// The output is ordinary `.md` files with YAML frontmatter, exactly as a local
// vault holds them — `storage/exampleBackend.ts` is the template. They then ride
// the entire existing pipeline: `parseToStoreItems` → expansion → agenda →
// search → backlinks. **There is no parallel parse path for subscriptions**, and
// the golden tests pin that by asserting the emitted markdown parses with an
// empty `roundTripLoss`.
//
// Nothing here mints an identifier at parse time. A slug is a deterministic hash
// of the event's own `UID`, so a feed re-fetched unchanged produces
// byte-identical files and reconcile sees no change at all.

import { stringify } from 'yaml'
import type { Repeat } from '@/types'
import {
  parseIcs, components, textValue, propValue, prop, props, param, splitList, unescapeText,
  calendarName, type IcsComponent,
} from './icsParse'
import { parseIcsDateTime, localDate, localTime, durationBetween, parseIsoDuration } from './icsDateTime'
import { rruleToRepeat } from './rruleToRepeat'

/** One synthesized entry file. `slug` is the bare file slug, no `.md`. */
export interface SynthesizedEntry {
  slug:    string
  content: string
}

export interface IcalSynthesis {
  /** `X-WR-CALNAME`, when the feed sets one — the wizard offers it as the vault name. */
  calendarName?: string
  entries: SynthesizedEntry[]
}

/**
 * A short, stable, URL-safe hash of an event's `UID`.
 *
 * FNV-1a: tiny, synchronous (Web Crypto's digest is async, and this runs
 * hundreds of times per refresh), and — the only property that actually matters
 * here — deterministic. The same UID must produce the same slug on every device
 * and every refresh forever, because that slug is the entry's identity: its URL,
 * its wikilink target, and its cache key.
 *
 * Collisions are handled by the caller rather than by widening the hash, since
 * two events colliding must resolve the same way every time too.
 */
export function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** `ical-<hash>` — flat and URL-safe, with no `/` to break the `$slug` path segment. */
function slugForUid(uid: string): string {
  return `ical-${shortHash(uid)}`
}

// ── One event's fields ───────────────────────────────────────────────────────

interface EventTiming {
  date:      string
  time?:     string
  duration?: string
  allDay:    boolean
  tzid?:     string
  /** DTSTART as a local `Date` — the anchor an RRULE expands from. */
  start:     Date
}

/** DTSTART plus whichever of DTEND / DURATION the event used to say how long it runs. */
function readTiming(event: IcsComponent): EventTiming | null {
  const dtstart = prop(event, 'DTSTART')
  if (!dtstart) return null
  const start = parseIcsDateTime(dtstart.value, param(dtstart, 'TZID'))
  if (!start) return null

  let end: Date | undefined
  const dtend = prop(event, 'DTEND')
  if (dtend) {
    end = parseIcsDateTime(dtend.value, param(dtend, 'TZID'))?.when
  } else {
    const iso = propValue(event, 'DURATION')
    const ms = iso ? parseIsoDuration(iso) : null
    if (ms !== null && ms > 0) end = new Date(start.when.getTime() + ms)
  }

  return {
    date:   localDate(start.when),
    allDay: start.allDay,
    start:  start.when,
    ...(start.allDay ? {} : { time: localTime(start.when) }),
    ...(end ? { duration: durationBetween(start.when, end, start.allDay) } : {}),
    ...(start.tzid ? { tzid: start.tzid } : {}),
  }
}

/**
 * Attendee display names.
 *
 * `CN` is the human name and is what a calendar shows; without one, the address
 * itself is a better participant than nothing — Meridian's participants are
 * free text, and "bob@example.com" at least identifies the person.
 */
function readParticipants(event: IcsComponent): string[] {
  const out: string[] = []
  for (const attendee of props(event, 'ATTENDEE')) {
    const cn = param(attendee, 'CN')?.trim()
    const value = unescapeText(attendee.value).trim().replace(/^mailto:/i, '')
    const name = cn && cn.length > 0 ? cn : value
    if (name.length > 0 && !out.includes(name)) out.push(name)
  }
  return out
}

/** The `extra` fields: everything with no home in the model, rendered by the read view. */
function readExtras(event: IcsComponent, uid: string, tzid: string | undefined): Record<string, string> {
  const extras: Record<string, string> = {}
  const location = textValue(event, 'LOCATION')?.trim()
  if (location) extras['location'] = location
  const url = propValue(event, 'URL')?.trim()
  if (url) extras['url'] = url
  const organizer = prop(event, 'ORGANIZER')
  if (organizer) {
    const cn = param(organizer, 'CN')?.trim()
    extras['organizer'] = cn && cn.length > 0 ? cn : unescapeText(organizer.value).trim().replace(/^mailto:/i, '')
  }
  extras['uid'] = uid
  // Deliberately NOT the registered `timezone` field: that one reads as "this
  // entry's date/time are expressed in this zone", and they are not — they were
  // converted to the viewer's local wall clock at synthesis time (see
  // icsDateTime.ts). An `extra` key under a name of our own keeps the original
  // zone visible as provenance without making a claim the data doesn't support.
  if (tzid) extras['sourceTimezone'] = tzid
  return extras
}

/** One `instances:` child — an override, an exclusion, or an explicitly-dated occurrence. */
interface InstanceEntry {
  date:      string
  time?:     string
  duration?: string
  excluded?: true
}

/**
 * The dates an EXDATE excludes.
 *
 * EXDATE may repeat and may carry a comma-separated list, and its values follow
 * DTSTART's own form — so an all-day series excludes whole dates while a timed
 * one excludes instants, and both come back as the local date the exclusion
 * lands on.
 */
function readExdates(event: IcsComponent): string[] {
  const out: string[] = []
  for (const exdate of props(event, 'EXDATE')) {
    const tzid = param(exdate, 'TZID')
    for (const value of splitList(exdate.value)) {
      const instant = parseIcsDateTime(value, tzid)
      if (instant) out.push(localDate(instant.when))
    }
  }
  return out
}

/**
 * Turn a `RECURRENCE-ID` override into `instances:` children.
 *
 * The RECURRENCE-ID names *which* generated occurrence is being replaced, and
 * the override's own DTSTART says what it was replaced with. When those are the
 * same day it is an edit in place. When they differ the occurrence moved, which
 * needs two children: the original date suppressed, and the new date added —
 * otherwise the series would show the meeting on both days.
 */
function overrideInstances(event: IcsComponent): InstanceEntry[] {
  const recurrenceId = prop(event, 'RECURRENCE-ID')
  if (!recurrenceId) return []
  const original = parseIcsDateTime(recurrenceId.value, param(recurrenceId, 'TZID'))
  const timing = readTiming(event)
  if (!original) return []
  if (!timing) return [{ date: localDate(original.when), excluded: true }]

  const moved: InstanceEntry = {
    date: timing.date,
    ...(timing.time ? { time: timing.time } : {}),
    ...(timing.duration ? { duration: timing.duration } : {}),
  }
  const originalDate = localDate(original.when)
  return originalDate === moved.date
    ? [moved]
    : [{ date: originalDate, excluded: true }, moved]
}

// ── Frontmatter assembly ─────────────────────────────────────────────────────

/**
 * Field order in the emitted YAML. Chosen to read like a hand-written entry —
 * identity, then when, then how it repeats, then the overrides — rather than in
 * whatever order the ICS happened to list things.
 */
function buildFrontmatter(fields: {
  title: string
  participants: string[]
  timing: EventTiming
  repeat?: Repeat
  instances: InstanceEntry[]
  extras: Record<string, string>
}): Record<string, unknown> {
  const out: Record<string, unknown> = { title: fields.title }
  if (fields.participants.length > 0) out['participants'] = fields.participants
  out['date'] = fields.timing.date
  if (fields.timing.time) out['time'] = fields.timing.time
  if (fields.timing.duration) out['duration'] = fields.timing.duration
  if (fields.repeat) out['repeat'] = fields.repeat
  if (fields.instances.length > 0) out['instances'] = fields.instances
  return { ...out, ...fields.extras }
}

/**
 * Render one entry file.
 *
 * `stringify` from the `yaml` package rather than hand-built lines: a SUMMARY
 * can hold a colon, a leading `#`, a quote or a newline, and getting the quoting
 * wrong turns a valid event into a parse failure the user cannot fix — the feed
 * is read-only. The frontmatter is then wrapped by hand rather than through
 * `saveFile` because there is no source file whose convention to preserve.
 */
function renderEntry(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringify(frontmatter).trimEnd()
  return body.length > 0 ? `---\n${yaml}\n---\n\n${body}\n` : `---\n${yaml}\n---\n`
}

// ── Synthesis ────────────────────────────────────────────────────────────────

/** A master VEVENT with the `RECURRENCE-ID` overrides that belong to it. */
interface EventGroup {
  uid:       string
  master:    IcsComponent
  overrides: IcsComponent[]
}

/**
 * Group VEVENTs by UID.
 *
 * A recurring event with edited occurrences arrives as several VEVENTs sharing
 * one UID: the master, plus one `RECURRENCE-ID` component per edited occurrence.
 * They are one Meridian entry with `instances:` overrides, not several entries —
 * so the grouping has to happen before anything is synthesized.
 */
function groupByUid(events: IcsComponent[]): EventGroup[] {
  const groups = new Map<string, EventGroup>()
  const orphans: IcsComponent[] = []

  for (const event of events) {
    if (propValue(event, 'STATUS')?.trim().toUpperCase() === 'CANCELLED') continue
    const uid = propValue(event, 'UID')?.trim()
    // No UID is a spec violation, but feeds in the wild do it. Fall back to the
    // event's own content so the slug stays deterministic across refreshes.
    const key = uid && uid.length > 0
      ? uid
      : `${propValue(event, 'SUMMARY') ?? ''}|${propValue(event, 'DTSTART') ?? ''}`

    if (prop(event, 'RECURRENCE-ID')) {
      const existing = groups.get(key)
      if (existing) existing.overrides.push(event)
      else orphans.push(event) // master not seen yet — resolved below
      continue
    }
    if (!groups.has(key)) groups.set(key, { uid: key, master: event, overrides: [] })
  }

  // Overrides that appeared before their master (feeds are not required to be
  // ordered). An override whose master never arrives becomes its own entry.
  for (const orphan of orphans) {
    const uid = propValue(orphan, 'UID')?.trim() ?? ''
    const group = groups.get(uid)
    if (group) group.overrides.push(orphan)
    else groups.set(`${uid}|orphan`, { uid: `${uid}|orphan`, master: orphan, overrides: [] })
  }

  return [...groups.values()]
}

function synthesizeGroup(group: EventGroup, now: Date): SynthesizedEntry | null {
  const { master } = group
  const timing = readTiming(master)
  if (!timing) return null // no usable DTSTART — not something the agenda can place

  const title = textValue(master, 'SUMMARY')?.trim() || 'Untitled event'
  const body  = textValue(master, 'DESCRIPTION')?.trim() ?? ''

  const instances: InstanceEntry[] = readExdates(master).map(date => ({ date, excluded: true as const }))
  for (const override of group.overrides) instances.push(...overrideInstances(override))

  let repeat: Repeat | undefined
  let anchor = timing
  const rrule = propValue(master, 'RRULE')
  if (rrule) {
    const mapped = rruleToRepeat(rrule, timing.start, now)
    if (mapped.kind === 'repeat') {
      repeat = mapped.repeat
    } else if (mapped.dates.length > 0) {
      // Unrepresentable rule: the dates are emitted explicitly instead. The
      // first becomes the entry's own `date`, the rest become `instances:` —
      // which is how an entry with no `repeat` block still shows up on many
      // days. Each carries its own time rather than relying on inheritance, so
      // what the file says is what the agenda shows.
      const [first, ...rest] = mapped.dates
      if (first) anchor = { ...timing, date: first }
      for (const date of rest) {
        instances.push({ date, ...(timing.time ? { time: timing.time } : {}), ...(timing.duration ? { duration: timing.duration } : {}) })
      }
    }
  }

  const frontmatter = buildFrontmatter({
    title,
    participants: readParticipants(master),
    timing: anchor,
    ...(repeat ? { repeat } : {}),
    // Sorted so a feed that reorders its EXDATEs between refreshes still
    // produces byte-identical files, and reconcile stays quiet.
    instances: instances.sort((a, b) => a.date.localeCompare(b.date)),
    extras: readExtras(master, group.uid, timing.tzid),
  })

  return { slug: slugForUid(group.uid), content: renderEntry(frontmatter, body) }
}

/**
 * Parse a feed and synthesize one entry per event.
 *
 * Returns `null` when the text is not a calendar at all — the failure the user
 * actually hits, when a URL serves an HTML sign-in page instead of a feed. The
 * wizard turns that into "that URL doesn't look like a calendar" rather than an
 * empty vault with no explanation.
 *
 * `now` is injectable purely so the bounded RRULE expansion window is
 * deterministic in tests.
 */
export function icsToEntries(text: string, now: Date = new Date()): IcalSynthesis | null {
  const calendar = parseIcs(text)
  if (!calendar) return null

  const entries: SynthesizedEntry[] = []
  const seen = new Set<string>()
  for (const group of groupByUid(components(calendar, 'VEVENT'))) {
    const entry = synthesizeGroup(group, now)
    if (!entry) continue
    // A hash collision (or a feed repeating a UID) must resolve the same way on
    // every device and every refresh, so the suffix comes from the order the
    // feed lists them in — not from a counter that depends on what else parsed.
    let slug = entry.slug
    for (let n = 2; seen.has(slug); n++) slug = `${entry.slug}-${n}`
    seen.add(slug)
    entries.push({ ...entry, slug })
  }

  const name = calendarName(calendar)
  return { ...(name ? { calendarName: name } : {}), entries }
}
