import type { Occurrence } from '@/types'
import { occKind } from '@/occView'
import { fmtISO } from '@/model'
import { sameDay, addDays, fmtTopBarMonth, fmtTopBarWeek } from '@/format'
import { weekStartFor, weekNumberFor } from './weekRange'
import { sortOccs } from './occSort'

const isOverdue = (o: Occurrence) => occKind(o) === 'task' && !o.metadata.done

// Asymmetric on purpose: overdue tasks can be arbitrarily old (see the fix
// that expanded this from 7 to 365 days so old tasks would still surface in
// the overdue section), but the agenda itself is a near-term view — planning
// further ahead than a season ahead belongs in month view, not an infinitely
// scrolling list. Also doubles as the span the day-by-day walk below covers,
// so exported for useAgendaSections' useExpandWithMultiday call.
export const PAST_WINDOW_DAYS = 365
export const FUTURE_WINDOW_DAYS = 90

// Size estimates for the virtualizer. Real sizes are measured after render
// (measureElement); accurate estimates just keep the scrollbar/scrollToIndex
// stable before a row has been measured. initialMeasurementsCache means
// returning users always get real sizes — estimates only matter on first visit.
//
// HEADER_H:    the overdue toggle row.
// MONTH_H:     the big per-month divider ("August 2026").
// WEEK_H:      the smaller per-week divider ("Week 32, Aug 3 – 9").
// ROW_H_META:  OccurrenceCard min-h-11 + py-2 padding + a meta row + AgendaRow mb-1.5 (6) ≈ 68px
// ROW_H_PLAIN: the same card with no meta row, so it sits on its min-h-11 (44)
//              floor + mb-1.5 (6) = 50px — the figure OccurrenceList.ts already
//              uses for exactly this shape.
// EMPTY_H:     a day-empty row (badge + "No events" text), no card at all.
// Update these if the corresponding row component's padding changes.
const HEADER_H = 40
const MONTH_H = 60
const WEEK_H = 36
const ROW_H_META = 68
const ROW_H_PLAIN = 50
const EMPTY_H = 44

/**
 * One virtualizable row of the agenda's flat row list. AgendaView virtualizes
 * this list directly (not `Section[]`), so an oversized section (notably
 * `__overdue__`, which pools every undone past task with no cap) never mounts
 * more than the viewport + overscan in one commit. See useAgendaSections.ts's
 * `rows`.
 */
export type AgendaRow =
  | {
      // The overdue toggle — the only 'header' row left once per-day headers
      // were replaced by inline badges (see 'occ'/'day-empty' below).
      kind: 'header'; key: string; dateKey: string; label: string
      collapsible: true; collapsed: boolean; count: number
    }
  // Always-rendered dividers for every month/week the agenda's window spans
  // (see the day-by-day walk in computeAgendaSections), independent of
  // whether that month/week has any content — a continuous ruler rather than
  // a label that only shows up where there's something to label.
  | { kind: 'month'; key: string; dateKey: string; label: string }
  | { kind: 'week'; key: string; dateKey: string; label: string }
  | {
      kind: 'occ'; key: string; dateKey: string; occ: Occurrence; showDate: boolean; isToday: boolean
      /** Set only on a day's first occurrence row — the weekday/day-number badge that replaces the old per-day text header. Later rows on the same day reserve the same gutter width but render no badge, so entries visually nest under it. */
      badge: { date: Date; isToday: boolean } | null
    }
  // A day forced into existence purely as a scroll target (the anchor day,
  // or today under the default anchor) with nothing scheduled on it.
  | { kind: 'day-empty'; key: string; dateKey: string; date: Date; isToday: boolean }

export type Section =
  | { kind: 'day'; key: string; dateKey: string; date: Date; isToday: boolean; items: Occurrence[]; rows: AgendaRow[] }
  | { kind: 'overdue'; key: string; items: Occurrence[]; rows: AgendaRow[] }

/**
 * Whether this row's card will render its meta row, mirroring OccurrenceCard's
 * own `showMeta`. AgendaView passes neither `showTime` nor
 * `showTagsParticipants`, so only three of the inputs vary here: the date badge
 * (overdue rows, which pass showDate), the time badge, and the duration chip.
 *
 * The one input this can't see is `listedOn` — backlinks, which live in the
 * store and never reach agendaSections. A plain row on a backlinked file
 * therefore estimates 50 and measures 68. That's the same direction and
 * magnitude of error the old single ROW_H had, but on far fewer rows, and
 * measureElement corrects it as soon as the row is on screen.
 */
function hasMetaRow(r: Extract<AgendaRow, { kind: 'occ' }>): boolean {
  return r.showDate || !!r.occ.time || !!r.occ.metadata.duration
}

export function estimateRow(r: AgendaRow): number {
  if (r.kind === 'header') return HEADER_H
  if (r.kind === 'month') return MONTH_H
  if (r.kind === 'week') return WEEK_H
  if (r.kind === 'day-empty') return EMPTY_H
  return hasMetaRow(r) ? ROW_H_META : ROW_H_PLAIN
}

/** The overdue section's header — a collapse toggle, not a plain label. */
function overdueHeaderRow(dateKey: string, collapsed: boolean, count: number): AgendaRow {
  return { kind: 'header', key: 'h|__overdue__', dateKey, label: 'Overdue', collapsible: true, collapsed, count }
}

// Keyed by dateKey (the section's own day, or `todayKey` for overdue rows —
// see the AgendaRow doc comment above) + occ id + instant, not just occ id:
// a multiday task pooled into overdue from several past days shares one id
// across those days, and a bare-id key would collide across the flat list.
function occRowKey(dateKey: string, o: Occurrence): string {
  return `${dateKey}|${o.id}|${o.metadata.jsTime?.getTime() ?? ''}`
}

/** Overdue's pooled rows — always carry a date badge on the card itself (`showDate`), never the gutter badge (they span many different days). */
function overdueRows(items: Occurrence[], dateKey: string): AgendaRow[] {
  return items.map(o => ({
    kind: 'occ', key: occRowKey(dateKey, o), dateKey, occ: o, showDate: true, isToday: false, badge: null,
  }))
}

/**
 * A single day's rendered rows: its occurrences with a gutter badge on the
 * first one, or — when the day was forced into existence with nothing
 * scheduled (see buildBucket) — one 'day-empty' row carrying the badge alone.
 */
function dayRows(items: Occurrence[], dateKey: string, date: Date, isToday: boolean): AgendaRow[] {
  if (items.length === 0) {
    return [{ kind: 'day-empty', key: `e|${dateKey}`, dateKey, date, isToday }]
  }
  return items.map((o, i) => ({
    kind: 'occ', key: occRowKey(dateKey, o), dateKey, occ: o, showDate: false, isToday,
    badge: i === 0 ? { date, isToday } : null,
  }))
}

export type FilterOccs = (occs: Occurrence[]) => Occurrence[]

const EMPTY_OCCS: Occurrence[] = []
const NO_CHANGES: number[] = []

/** One calendar day of the agenda, plus everything derived from it. */
interface DayBucket {
  key: string
  date: Date
  /** `key < todayKey` — fixed for the lifetime of the grouping (which is keyed on `today`). */
  isPast: boolean
  /** Positions in `allOccs` that landed on this day, in expansion order. */
  indices: number[]
  /** `indices.map(i => allOccs[i])` — the raw, unfiltered, unsorted occurrences. */
  occs: Occurrence[]
  /** Filtered overdue items hoisted out of a past day (unsorted); always empty for current/future days. */
  overdue: Occurrence[]
  /** The day's rendered section, or null when the day drops out of the agenda entirely. */
  section: Section | null
}

export interface AgendaSectionCache {
  allOccs: Occurrence[]
  todayMs: number
  anchorMs: number
  nowMs: number
  filterOccs: FilterOccs
  /** Whether the overdue section was built collapsed — see calendar/viewState.ts. */
  overdueCollapsed: boolean
  /** Locale week-start (0=Sun, 1=Mon, 6=Sat) — gates week-divider boundaries. */
  ws: 0 | 1 | 6
  buckets: Map<string, DayBucket>
  /** All bucket keys, ascending — stable while the grouping is reused. */
  sortedKeys: string[]
  /** `keyByIndex[i]` is the day key of `allOccs[i]`, or undefined when it has no jsTime. */
  keyByIndex: (string | undefined)[]
  overdueSection: Section | null
  sections: Section[]
  goToIndex: number
  /** Flattened, week/month-divider-interspersed row list — what AgendaView actually virtualizes. */
  rows: AgendaRow[]
  /** Index into `rows` of the scroll-to-today target's own first row (see `goToIndex`). */
  goToRowIndex: number
}

/**
 * Positions in `next` whose occurrence object changed but stayed on the same
 * instant — or null when the two arrays can't be aligned position-for-position.
 *
 * This is the entire safety condition for reusing a cached grouping. Buckets
 * store *positions* into `allOccs`, so as long as the arrays are the same
 * length and every position keeps its `jsTime`, every bucket's index list is
 * still correct and only the touched days need rebuilding. A structural
 * re-expansion (a date edit, an added/removed item, a changed repeat rule)
 * either changes the length or moves an occurrence to another instant, so it
 * returns null here and forces a full re-group — no coordination with
 * computeExpansionCache's own fast path required.
 */
function changedIndices(prev: Occurrence[], next: Occurrence[]): number[] | null {
  if (prev === next) return NO_CHANGES
  if (prev.length !== next.length) return null
  const out: number[] = []
  for (let i = 0; i < next.length; i++) {
    // Both in range: i < next.length and the lengths were equal-checked above.
    const a = prev[i]!, b = next[i]!
    if (a === b) continue
    if ((a.metadata.jsTime?.getTime() ?? null) !== (b.metadata.jsTime?.getTime() ?? null)) return null
    out.push(i)
  }
  return out
}

interface BuildCtx {
  today: Date
  now: Date
  todayKey: string
  /** See computeAgendaSections' `anchor` param. */
  anchorKey: string
  filterOccs: FilterOccs
}

/**
 * Derive a day's `overdue` items and `section` from its raw occurrences.
 * Past days hand their undone tasks to the shared overdue section and keep
 * only what's left; a past day with nothing left drops out of the agenda.
 * Today's section is kept even when empty so goToday() always has a target.
 */
function buildBucket(b: DayBucket, ctx: BuildCtx): DayBucket {
  const filtered = ctx.filterOccs(b.occs)

  if (b.isPast) {
    const overdue = filtered.filter(isOverdue)
    const items = sortOccs(filtered.filter(o => !isOverdue(o)), ctx.now)
    return {
      ...b,
      overdue,
      // `|| b.key === ctx.anchorKey` forces a render even when empty — the
      // anchor always needs a section to scroll to, mirroring the today
      // special-case below (identical when anchor is today, the default).
      section: items.length || b.key === ctx.anchorKey
        ? { kind: 'day', key: b.key, dateKey: b.key, date: b.date, isToday: false, items, rows: dayRows(items, b.key, b.date, false) }
        : null,
    }
  }

  const items = sortOccs(filtered, ctx.now)
  const isToday = sameDay(b.date, ctx.today)
  return {
    ...b,
    overdue: EMPTY_OCCS,
    section: items.length || b.key === ctx.anchorKey
      ? { kind: 'day', key: b.key, dateKey: b.key, date: b.date, isToday, items, rows: dayRows(items, b.key, b.date, isToday) }
      : null,
  }
}

/** Bucket every occurrence by its calendar day, seeding the anchor so it always exists. */
function groupByDay(allOccs: Occurrence[], todayKey: string, anchor: Date, anchorKey: string) {
  const buckets = new Map<string, DayBucket>()
  const keyByIndex = new Array<string | undefined>(allOccs.length)

  buckets.set(anchorKey, {
    key: anchorKey,
    date: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()),
    isPast: anchorKey < todayKey,
    indices: [], occs: [], overdue: EMPTY_OCCS, section: null,
  })

  for (let i = 0; i < allOccs.length; i++) {
    const occ = allOccs[i]!  // i < allOccs.length
    const jsTime = occ.metadata.jsTime
    if (!jsTime) continue
    const k = fmtISO(jsTime)
    keyByIndex[i] = k
    let b = buckets.get(k)
    if (!b) {
      b = {
        key: k,
        date: new Date(jsTime.getFullYear(), jsTime.getMonth(), jsTime.getDate()),
        isPast: k < todayKey,
        indices: [], occs: [], overdue: EMPTY_OCCS, section: null,
      }
      buckets.set(k, b)
    }
    b.indices.push(i)
    b.occs.push(occ)
  }

  return { buckets, keyByIndex, sortedKeys: [...buckets.keys()].sort() }
}

/** "Week N, <range>" — reuses the topbar's own range formatter so the two stay in sync. */
function weekLabel(weekStart: Date, today: Date): string {
  return `Week ${weekNumberFor(weekStart)}, ${fmtTopBarWeek(weekStart, addDays(weekStart, 6), today)}`
}

/**
 * The agenda's grouping + sorting stage, as an explicit cache rather than a
 * chain of useMemos.
 *
 * A done-toggle (or any priority/participant/file-title edit) hands us a fresh
 * `allOccs` array whose *identity* changed but whose day layout did not — plain
 * memo deps can't see that, so every toggle used to re-bucket the whole vault
 * (~42 ms at 8.7k occurrences) and re-sort all ~455 sections (~12 ms). Here the
 * two stages are invalidated independently:
 *
 *   - grouping (buckets/keyByIndex/sortedKeys) survives any change that keeps
 *     occurrences on their instants — see changedIndices;
 *   - per-day filter+sort survives unless that day's occurrences changed, and
 *     is re-run wholesale when `now` ticks, `today` rolls over, or the calendar
 *     filter changes (all of which every section's contents depend on).
 *
 * Unchanged `Section` objects (and their `rows`) are returned by reference,
 * which is what keeps AgendaRow's memo from re-rendering days the toggle
 * didn't touch — the day-by-day flatten pass below always re-runs in full
 * (it's cheap, ~455 iterations of array pushes), but it only ever *reads*
 * `buckets`, so an untouched day still contributes the same `rows` array by
 * reference.
 *
 * `anchor` defaults to `today` — the ordinary case, where the seeded/scroll
 * target bucket is today's own and goToIndex prefers the overdue section over
 * it exactly as before. Passing a different anchor (Agenda re-centered on a
 * day reached via Month/Day) instead seeds that day's bucket and targets it
 * directly, skipping the overdue preference — see the goToIndex comment below.
 */
export function computeAgendaSections(
  prev: AgendaSectionCache | null,
  allOccs: Occurrence[],
  today: Date,
  now: Date,
  filterOccs: FilterOccs,
  anchor: Date = today,
  overdueCollapsed = false,
  ws: 0 | 1 | 6 = 1,
): AgendaSectionCache {
  const todayMs = today.getTime()
  const anchorMs = anchor.getTime()
  const nowMs = now.getTime()

  if (prev && prev.allOccs === allOccs && prev.todayMs === todayMs && prev.anchorMs === anchorMs && prev.nowMs === nowMs && prev.filterOccs === filterOccs && prev.overdueCollapsed === overdueCollapsed && prev.ws === ws) {
    return prev
  }

  const todayKey = fmtISO(today)
  const anchorKey = fmtISO(anchor)
  const ctx: BuildCtx = { today, now, todayKey, anchorKey, filterOccs }

  // `today`/`anchor` gate grouping reuse because they decide the seeded
  // bucket and (for today) each bucket's isPast flag.
  const changed = prev && prev.todayMs === todayMs && prev.anchorMs === anchorMs ? changedIndices(prev.allOccs, allOccs) : null
  // overdueCollapsed only changes the overdue section's own rows, but it gates
  // section reuse wholesale: the `sectionsReusable && !pastDirty` branch below
  // hands back `prev.overdueSection` by reference, which would keep the stale
  // expansion when the flag flips with no occurrence change to force a rebuild.
  const sectionsReusable = changed !== null && prev !== null && prev.nowMs === nowMs && prev.filterOccs === filterOccs && prev.overdueCollapsed === overdueCollapsed

  let buckets: Map<string, DayBucket>
  let keyByIndex: (string | undefined)[]
  let sortedKeys: string[]
  // Keys whose section/overdue must be rebuilt; null means "all of them".
  let dirty: Set<string> | null

  if (changed !== null && prev !== null) {
    const touched = new Set<string>()
    for (const i of changed) {
      const k = prev.keyByIndex[i]
      if (k !== undefined) touched.add(k)
    }

    // Nothing moved and nothing else changed — hand back the same cache so
    // AgendaView's virtualizer and scroll listener don't see a new identity.
    // `ws` doesn't gate bucket reuse (sectionsReusable, below) since it never
    // affects bucket-building — only the flatten stage's week dividers read
    // it — but it must still gate *this* shortcut, or a week-start-only
    // change would hand back the old row list without ever re-walking it.
    if (sectionsReusable && prev.ws === ws && touched.size === 0) {
      return prev.allOccs === allOccs ? prev : { ...prev, allOccs }
    }

    keyByIndex = prev.keyByIndex
    sortedKeys = prev.sortedKeys
    buckets = new Map(prev.buckets)
    // Re-read the touched days' occurrences out of the new array. Positions are
    // known-aligned, so the index lists still point at the right occurrences.
    for (const k of touched) {
      const b = buckets.get(k)
      if (b) buckets.set(k, { ...b, occs: b.indices.map(i => allOccs[i]!) })
    }
    dirty = sectionsReusable ? touched : null
  } else {
    ({ buckets, keyByIndex, sortedKeys } = groupByDay(allOccs, todayKey, anchor, anchorKey))
    dirty = null
  }

  let pastDirty = false
  for (const k of dirty ?? sortedKeys) {
    const b = buckets.get(k)
    if (!b) continue
    if (b.isPast) pastDirty = true
    buckets.set(k, buildBucket(b, ctx))
  }

  // The overdue section pools every past day, so it only survives when no past
  // day was rebuilt.
  let overdueSection: Section | null
  if (sectionsReusable && !pastDirty) {
    overdueSection = prev.overdueSection
  } else {
    const pooled: Occurrence[] = []
    for (const k of sortedKeys) {
      if (k >= todayKey) break
      const b = buckets.get(k)
      if (b) pooled.push(...b.overdue)
    }
    if (pooled.length) {
      const items = sortOccs(pooled, now)
      overdueSection = {
        kind: 'overdue', key: '__overdue__', items,
        // Overdue rows carry todayKey (not each occurrence's own past day) so
        // the top-bar label falls back to today's month over this block,
        // matching AgendaView's updateTopDate behavior before flattening.
        //
        // Collapsed, the section is its header and nothing else — `items` still
        // carries the full list, so only what's rendered changes. That's what
        // keeps the overdue preference below from landing on an unbounded wall.
        rows: overdueCollapsed
          ? [overdueHeaderRow(todayKey, true, items.length)]
          : [overdueHeaderRow(todayKey, false, items.length), ...overdueRows(items, todayKey)],
      }
    } else {
      overdueSection = null
    }
  }

  // anchorKey === todayKey (the default, anchor omitted) is the ordinary
  // "scroll to today" case: prefer the overdue section when there is one,
  // else today's own section — exactly the pre-anchor behavior. A different
  // anchor means an explicit jump to that specific day instead, so it always
  // wins regardless of overdue — surfacing unrelated overdue work isn't what
  // "take me to this day" asked for.
  const preferOverdue = anchorKey === todayKey

  // Flatten: a day-by-day walk over the whole [anchor-365, anchor+90] window
  // (not just occurrence-bearing days), inserting a month/week divider row
  // the first time each is entered — every week gets a row even when it has
  // nothing scheduled, so the agenda reads as a continuous ruler rather than
  // a list with unexplained gaps. Overdue is spliced in at the today/future
  // boundary: normally that lands mid-walk (today's own divider rows go out
  // first, then Overdue, then today's own content), but if `anchor` is far
  // enough from today that the whole window is on one side of it, clamping
  // into [from, to] below still resolves it to one end of the window rather
  // than dropping it.
  // Mirrors the row walk's own placement below: past days ascending, then
  // overdue, then current/future days ascending — kept in this order (rather
  // than pushing overdue last) so `sections`/`goToIndex` stay meaningful for
  // callers reasoning about chronology independent of the divider rows.
  const sections: Section[] = []
  for (const k of sortedKeys) {
    if (k >= todayKey) break
    const s = buckets.get(k)?.section
    if (s) sections.push(s)
  }
  if (overdueSection) sections.push(overdueSection)
  for (const k of sortedKeys) {
    if (k < todayKey) continue
    const s = buckets.get(k)?.section
    if (s) sections.push(s)
  }

  const rows: AgendaRow[] = []
  let goToRowIndex = -1

  const from = addDays(anchor, -PAST_WINDOW_DAYS)
  const to = addDays(anchor, FUTURE_WINDOW_DAYS)
  // The single point in the walk where Overdue splices in: today, clamped
  // into [from, to] so it still resolves to one end of the window (rather
  // than never matching any `day` in the loop below) when `anchor` is far
  // enough from today that the whole window lands on one side of it.
  const overdueAtMs = Math.max(from.getTime(), Math.min(todayMs, to.getTime()))

  let lastMonthKey = ''
  let lastWeekKey = ''
  for (let day = from; day.getTime() <= to.getTime(); day = addDays(day, 1)) {
    const dateKey = fmtISO(day)

    const monthKey = `${day.getFullYear()}-${day.getMonth()}`
    if (monthKey !== lastMonthKey) {
      lastMonthKey = monthKey
      rows.push({ kind: 'month', key: `m|${monthKey}`, dateKey, label: fmtTopBarMonth(day, today) })
    }
    const weekStart = weekStartFor(day, ws)
    const weekKey = fmtISO(weekStart)
    if (weekKey !== lastWeekKey) {
      lastWeekKey = weekKey
      rows.push({ kind: 'week', key: `w|${weekKey}`, dateKey, label: weekLabel(weekStart, today) })
    }

    if (day.getTime() === overdueAtMs && overdueSection) {
      if (preferOverdue) goToRowIndex = rows.length
      for (const r of overdueSection.rows) rows.push(r)
    }

    const section = buckets.get(dateKey)?.section
    if (section) {
      if (dateKey === anchorKey) {
        if (preferOverdue) { if (goToRowIndex < 0) goToRowIndex = rows.length }
        else goToRowIndex = rows.length
      }
      for (const r of section.rows) rows.push(r)
    }
  }

  // goToIndex (section-granular) is kept only for tests/consumers that still
  // reason in terms of sections; goToRowIndex above is what AgendaView uses.
  const goToIndex = overdueSection && preferOverdue
    ? sections.indexOf(overdueSection)
    : sections.findIndex(s => (s.kind === 'day' && s.dateKey === anchorKey))

  return {
    allOccs, todayMs, anchorMs, nowMs, filterOccs, overdueCollapsed, ws, buckets, sortedKeys, keyByIndex,
    overdueSection, sections, goToIndex, rows, goToRowIndex,
  }
}
