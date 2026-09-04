import type { Occurrence } from '@/types'
import { fmtISO } from '@/model'
import { sameDay, addDays, fmtTopBarMonth, fmtTopBarWeek } from '@/format'
import { CHUNK_DAYS, chunkIndexFor, chunkRange } from './agendaChunks'
import { weekStartFor, weekNumberFor } from './weekRange'
import { sortOccs } from './occSort'
import type { OverdueGroup } from './overduePool'
import type { FilterOccs } from './useCalendarFilter'

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
// EMPTY_H:     a day-empty row (badge + "No events" text), no card at all —
//              min-h-11 (44) + its own mt-3 (12), always a fresh day.
// Update these if the corresponding row component's padding changes.
const HEADER_H = 40
const MONTH_H = 60
const WEEK_H = 36
const ROW_H_META = 68
const ROW_H_PLAIN = 50
const EMPTY_H = 56
// OVERDUE_GROUP_H: the same card as ROW_H_META — an overdue group row always
// shows its oldest date, so its meta row is never absent.
const OVERDUE_GROUP_H = 68

/**
 * One virtualizable row of the agenda's flat row list. AgendaView virtualizes
 * this list directly (not `Section[]`), so an oversized section (notably
 * `__overdue__`, which carries one row per unfinished series with no cap) never
 * mounts more than the viewport + overscan in one commit. See
 * useAgendaSections.ts's `rows`.
 */
export type AgendaRow =
  | {
      // The overdue toggle — the only 'header' row left once per-day headers
      // were replaced by inline badges (see 'occ'/'day-empty' below).
      kind: 'header'; key: string; dateKey: string; label: string
      collapsible: true; collapsed: boolean; count: number
    }
  // Always-rendered dividers for every month/week the agenda's window spans
  // (see the per-chunk day walk in computeChunkRows), independent of
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
  // One overdue series (or standalone task), collapsed to a single row — see
  // overduePool.ts's OverdueGroup. The only row kind whose occurrence is a
  // *representative* rather than the row's whole content: the group's other
  // occurrences are rendered on their own past days further up the list.
  | {
      kind: 'overdue-group'; key: string; dateKey: string; occ: Occurrence
      /** How many overdue occurrences this row stands for; always ≥ 1. */
      count: number
      /** `occ.metadata.jsTime` — the oldest overdue instant in the group. */
      oldest: Date
    }

export type Section =
  | { kind: 'day'; key: string; dateKey: string; date: Date; isToday: boolean; items: Occurrence[]; rows: AgendaRow[] }
  | { kind: 'overdue'; key: string; groups: OverdueGroup[]; rows: AgendaRow[] }

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
  if (r.kind === 'overdue-group') return OVERDUE_GROUP_H
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
//
// Deliberately carries no chunk index: `computeAgendaScrollRestore`'s
// key-matched measurement snapshot, `useVirtualFlip` and the virtualizer's
// own `getItemKey` all identify a row across rebuilds by this string, and a
// row must keep its identity when the loaded chunk run around it changes.
function occRowKey(dateKey: string, o: Occurrence): string {
  return `${dateKey}|${o.id}|${o.metadata.jsTime?.getTime() ?? ''}`
}

/**
 * Overdue's grouped rows — one per series, carrying its representative
 * occurrence's own date on the card (`showDate` in the renderer) rather than a
 * gutter day badge, since a group spans many different days.
 *
 * Keyed on the group key rather than occRowKey: a group's identity is the
 * series, and it must survive the representative being completed and replaced
 * by the next-oldest one.
 */
function overdueGroupRows(groups: OverdueGroup[], dateKey: string): AgendaRow[] {
  return groups.map(g => ({
    kind: 'overdue-group', key: `og|${g.key}`, dateKey, occ: g.occ, count: g.count, oldest: g.oldest,
  }))
}

/** The overdue block: its toggle header, and — unless collapsed — one row per group. */
function buildOverdueSection(groups: OverdueGroup[], todayKey: string, collapsed: boolean): Section | null {
  if (groups.length === 0) return null
  return {
    kind: 'overdue', key: '__overdue__', groups,
    // Overdue rows carry todayKey (not each group's own oldest day) so the
    // top-bar label falls back to today's month over this block, matching
    // AgendaView's updateTopDate behavior before flattening.
    //
    // Collapsed, the section is its header and nothing else — `groups` still
    // carries the full list, so only what's rendered changes. That's what keeps
    // the overdue preference below from landing on an unbounded wall.
    rows: collapsed
      ? [overdueHeaderRow(todayKey, true, groups.length)]
      : [overdueHeaderRow(todayKey, false, groups.length), ...overdueGroupRows(groups, todayKey)],
  }
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


const NO_CHANGES: number[] = []

/** One calendar day of the agenda, plus everything derived from it. */
interface DayBucket {
  key: string
  date: Date
  /** Positions in the chunk's own `occs` that landed on this day, in expansion order. */
  indices: number[]
  /** `indices.map(i => occs[i])` — the raw, unfiltered, unsorted occurrences. */
  occs: Occurrence[]
  /** The day's rendered section, or null when the day drops out of the agenda entirely. */
  section: Section | null
}

/**
 * Positions in `next` whose occurrence object changed but stayed on the same
 * instant — or null when the two arrays can't be aligned position-for-position.
 *
 * This is the entire safety condition for reusing a cached grouping. Buckets
 * store *positions* into one chunk's `occs`, so as long as the arrays are the
 * same length and every position keeps its `jsTime`, every bucket's index list
 * is still correct and only the touched days need rebuilding. A structural
 * re-expansion (a date edit, an added/removed item, a changed repeat rule)
 * either changes the length or moves an occurrence to another instant, so it
 * returns null here and forces a full re-group — no coordination with
 * computeExpansionCache's own fast path required.
 *
 * Scoped to a single chunk (see ChunkSectionCache), which is what makes the
 * length check survivable: an added or deleted item invalidates the chunks its
 * occurrences fall in and leaves every other chunk's grouping standing, where
 * one flat array over the whole window used to be dropped in its entirety.
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

/** Everything a chunk's build needs that is the same for every chunk in the run. */
interface BuildCtx {
  today: Date
  now: Date
  todayMs: number
  nowMs: number
  todayKey: string
  /** See computeAgendaSections' `anchor` param. */
  anchorKey: string
  anchor: Date
  /** The chunk the anchor day falls in — the only one that seeds its bucket. */
  anchorChunk: number
  filterOccs: FilterOccs
  /**
   * A serializable description of the filter *state* — what the section cache
   * keys on. See useCalendarFilter's `filterKey`.
   */
  filterKey: string
  ws: 0 | 1 | 6
}

/**
 * Derive a day's `section` from its raw occurrences: filter, sort, render.
 * Today's (and the anchor's) section is kept even when empty so goToday()
 * always has a target.
 *
 * Past days used to be special — they *hoisted* their undone tasks into the
 * shared overdue section and kept only what was left, so a past day holding
 * nothing else dropped out of the agenda entirely and its tasks existed
 * nowhere but the overdue block. Now that the overdue block is one row per
 * series (see overduePool.ts), those occurrences would no longer be
 * individually reachable — so every day, past or not, simply renders what it
 * holds. The knock-on is deliberate: past days that used to vanish now render.
 */
function buildBucket(b: DayBucket, ctx: BuildCtx): DayBucket {
  const items = sortOccs(ctx.filterOccs(b.occs), ctx.now)
  const isToday = sameDay(b.date, ctx.today)
  return {
    ...b,
    // `|| b.key === ctx.anchorKey` forces a render even when empty — the
    // anchor always needs a section to scroll to (identical to the today case
    // when anchor is today, the default).
    section: items.length || b.key === ctx.anchorKey
      ? { kind: 'day', key: b.key, dateKey: b.key, date: b.date, isToday, items, rows: dayRows(items, b.key, b.date, isToday) }
      : null,
  }
}

/**
 * Bucket one chunk's occurrences by calendar day, seeding the anchor's own
 * bucket in whichever chunk contains it so it always exists.
 */
function groupChunkByDay(occs: Occurrence[], index: number, ctx: BuildCtx) {
  const buckets = new Map<string, DayBucket>()
  const keyByIndex = new Array<string | undefined>(occs.length)

  if (index === ctx.anchorChunk) {
    buckets.set(ctx.anchorKey, {
      key: ctx.anchorKey,
      date: new Date(ctx.anchor.getFullYear(), ctx.anchor.getMonth(), ctx.anchor.getDate()),
      indices: [], occs: [], section: null,
    })
  }

  for (let i = 0; i < occs.length; i++) {
    const occ = occs[i]!  // i < occs.length
    const jsTime = occ.metadata.jsTime
    if (!jsTime) continue
    const k = fmtISO(jsTime)
    keyByIndex[i] = k
    let b = buckets.get(k)
    if (!b) {
      b = {
        key: k,
        date: new Date(jsTime.getFullYear(), jsTime.getMonth(), jsTime.getDate()),
        indices: [], occs: [], section: null,
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

function monthKeyOf(day: Date): string {
  return `${day.getFullYear()}-${day.getMonth()}`
}

/**
 * `keySuffix` disambiguates assembleAgendaRows' synthetic leading divider
 * (below) from the plain in-chunk one this same function also builds for a
 * genuine month transition. Without it the two collide on key whenever the
 * run's mid-month start and a real transition land in the same month — see
 * the leading-divider call site for why that collision is a real bug, not
 * just a naming nicety.
 */
function monthDividerRow(day: Date, today: Date, keySuffix = ''): AgendaRow {
  return { kind: 'month', key: `m|${monthKeyOf(day)}${keySuffix}`, dateKey: fmtISO(day), label: fmtTopBarMonth(day, today) }
}

/**
 * One chunk's grouped, sorted and flattened rows — everything
 * `computeAgendaSections` used to do in a single pass over the whole window,
 * scoped to a fixed 28-day slice of the absolute grid (agendaChunks.ts).
 *
 * Cached per chunk index, so adding a chunk at either end of the loaded run
 * rebuilds nothing in the chunks already loaded, and a done-toggle rebuilds
 * the one chunk it landed in rather than the whole window.
 */
interface ChunkSectionCache {
  index: number
  /** The chunk's own expansion output — see useAgendaChunks. */
  occs: Occurrence[]
  todayMs: number
  nowMs: number
  filterKey: string
  /**
   * The anchor day this chunk seeded a (possibly empty) bucket for, or null
   * when the anchor falls outside it. Only the anchor's own chunk cares that
   * the anchor moved — every other chunk's grouping and sections survive a
   * jump untouched, which is the whole point of an absolute grid.
   */
  seededAnchorKey: string | null
  ws: 0 | 1 | 6
  buckets: Map<string, DayBucket>
  /** All bucket keys, ascending — stable while the grouping is reused. */
  sortedKeys: string[]
  /** `keyByIndex[i]` is the day key of `occs[i]`, or undefined when it has no jsTime. */
  keyByIndex: (string | undefined)[]
  /** This chunk's day sections, ascending — assembled into the global list. */
  sections: Section[]
  /**
   * The chunk's own rows: its month/week dividers and its days' content, in
   * walk order. Carries no overdue block — that is spliced in at assembly
   * (see assembleAgendaRows), so a chunk stays independent of it.
   */
  rows: AgendaRow[]
  /**
   * For every one of the chunk's 28 days, the index in `rows` where that day's
   * own content starts — i.e. just after its month/week dividers, and just
   * before its section's rows. Recorded for *every* walked day, content or
   * not, because it is also where the overdue block splices in and where
   * `goToRowIndex` lands.
   */
  dayRowStart: Map<string, number>
}

/**
 * The day-by-day walk over one chunk: month/week dividers, then each day's
 * section rows.
 *
 * **Divider placement is chunk-local**, which is what lets chunks be built and
 * cached independently. A day opens a new month/week divider iff its own
 * month/week differs from the *previous calendar day's* — pure date math, no
 * neighbouring chunk's rows and no data. The grid is 28 days (4 × 7) anchored
 * on a week start, so a chunk's first day is always a week start too: the week
 * divider at a chunk boundary is emitted exactly once, by the chunk that owns
 * that day, and never duplicated by its neighbour.
 *
 * The one row this cannot produce is the divider that opens the *run*: the
 * agenda's topmost row is a month divider even when the run starts mid-month,
 * and whether that is needed is a property of the run, not of the chunk. See
 * assembleAgendaRows' leading divider.
 */
function walkChunk(index: number, buckets: Map<string, DayBucket>, ctx: BuildCtx) {
  const rows: AgendaRow[] = []
  const sections: Section[] = []
  const dayRowStart = new Map<string, number>()

  const firstDay = chunkRange(index, ctx.ws).from
  let prev = addDays(firstDay, -1)
  let prevMonthKey = monthKeyOf(prev)
  let prevWeekKey = fmtISO(weekStartFor(prev, ctx.ws))

  let day = firstDay
  for (let i = 0; i < CHUNK_DAYS; i++, prev = day, day = addDays(day, 1)) {
    const dateKey = fmtISO(day)

    const monthKey = monthKeyOf(day)
    if (monthKey !== prevMonthKey) {
      prevMonthKey = monthKey
      rows.push(monthDividerRow(day, ctx.today))
    }
    const weekStart = weekStartFor(day, ctx.ws)
    const weekKey = fmtISO(weekStart)
    if (weekKey !== prevWeekKey) {
      prevWeekKey = weekKey
      rows.push({ kind: 'week', key: `w|${weekKey}`, dateKey, label: weekLabel(weekStart, ctx.today) })
    }

    dayRowStart.set(dateKey, rows.length)

    const section = buckets.get(dateKey)?.section
    if (section) {
      sections.push(section)
      for (const r of section.rows) rows.push(r)
    }
  }

  return { rows, sections, dayRowStart }
}

/**
 * One chunk's grouping + sorting + flattening stage, as an explicit cache
 * rather than a chain of useMemos.
 *
 * A done-toggle (or any priority/participant/file-title edit) hands us a fresh
 * `occs` array whose *identity* changed but whose day layout did not — plain
 * memo deps can't see that, so every toggle used to re-bucket the whole vault
 * and re-sort every section. Here the two stages are invalidated
 * independently:
 *
 *   - grouping (buckets/keyByIndex/sortedKeys) survives any change that keeps
 *     occurrences on their instants — see changedIndices;
 *   - per-day filter+sort survives unless that day's occurrences changed, and
 *     is re-run wholesale when `now` ticks, `today` rolls over, or the calendar
 *     filter changes (all of which every section's contents depend on).
 *
 * Unchanged `Section` objects (and their `rows`) are returned by reference,
 * which is what keeps AgendaRow's memo from re-rendering days the toggle
 * didn't touch — the chunk's own 28-day walk always re-runs in full when any
 * of its days is dirty (it's cheap), but it only ever *reads* `buckets`, so an
 * untouched day still contributes the same `rows` array by reference. A chunk
 * with no dirty day returns `prev` outright, so its whole `rows` array keeps
 * its identity and the assembly below can skip it entirely.
 */
function computeChunkRows(
  prev: ChunkSectionCache | null,
  index: number,
  occs: Occurrence[],
  ctx: BuildCtx,
): ChunkSectionCache {
  // The seeded anchor gates both reuse gates below: it decides the extra
  // bucket groupChunkByDay creates, and the day buildBucket force-renders a
  // section for even when empty. Nothing else either reads can change without
  // changing `occs`.
  const seededAnchorKey = index === ctx.anchorChunk ? ctx.anchorKey : null
  const groupingReusable = prev !== null && prev.index === index && prev.seededAnchorKey === seededAnchorKey
  const changed = groupingReusable ? changedIndices(prev.occs, occs) : null
  const sectionsReusable = changed !== null && prev !== null
    && prev.todayMs === ctx.todayMs && prev.nowMs === ctx.nowMs && prev.filterKey === ctx.filterKey

  let buckets: Map<string, DayBucket>
  let keyByIndex: (string | undefined)[]
  let sortedKeys: string[]
  // Keys whose section must be rebuilt; null means "all of them".
  let dirty: Set<string> | null

  if (changed !== null && prev !== null) {
    const touched = new Set<string>()
    for (const i of changed) {
      const k = prev.keyByIndex[i]
      if (k !== undefined) touched.add(k)
    }

    // Nothing moved and nothing else changed — hand back the same chunk cache
    // so its `rows` array keeps its identity and the assembly can reuse it.
    // `ws` doesn't gate bucket reuse (sectionsReusable, above) since it never
    // affects bucket-building — only the walk's dividers read it — but it must
    // still gate *this* shortcut, or a week-start-only change would hand back
    // the old row list without ever re-walking it.
    if (sectionsReusable && prev.ws === ctx.ws && touched.size === 0) {
      return prev.occs === occs ? prev : { ...prev, occs }
    }

    keyByIndex = prev.keyByIndex
    sortedKeys = prev.sortedKeys
    buckets = new Map(prev.buckets)
    // Re-read the touched days' occurrences out of the new array. Positions are
    // known-aligned, so the index lists still point at the right occurrences.
    for (const k of touched) {
      const b = buckets.get(k)
      if (b) buckets.set(k, { ...b, occs: b.indices.map(i => occs[i]!) })
    }
    dirty = sectionsReusable ? touched : null
  } else {
    ({ buckets, keyByIndex, sortedKeys } = groupChunkByDay(occs, index, ctx))
    dirty = null
  }

  for (const k of dirty ?? sortedKeys) {
    const b = buckets.get(k)
    if (!b) continue
    buckets.set(k, buildBucket(b, ctx))
  }

  const { rows, sections, dayRowStart } = walkChunk(index, buckets, ctx)

  return {
    index, occs, todayMs: ctx.todayMs, nowMs: ctx.nowMs, filterKey: ctx.filterKey,
    seededAnchorKey, ws: ctx.ws,
    buckets, sortedKeys, keyByIndex, sections, rows, dayRowStart,
  }
}

/** What one assembly pass produces — see assembleAgendaRows. */
interface Assembly {
  rows: AgendaRow[]
  goToRowIndex: number
  sections: Section[]
  goToIndex: number
}

/**
 * Concatenate the loaded chunks' rows into the one list AgendaView
 * virtualizes, splicing the overdue block in at the today boundary and
 * resolving the scroll target over the assembled result.
 *
 * Nothing here rebuilds a row: every row object comes from a chunk's own
 * `rows` array (or from `overdueSection.rows`) by reference, which is what
 * keeps AgendaRow's memo quiet across a rebuild that only touched one chunk.
 *
 * Overdue and `goToRowIndex` are deliberately *not* chunked. The overdue block
 * is already independent of the agenda's window (overduePool.ts) and spans it
 * rather than belonging to any one chunk, and the scroll target is an index
 * into the assembled list — neither is a property a chunk could cache.
 */
function assembleAgendaRows(
  chunks: ChunkSectionCache[],
  overdueSection: Section | null,
  ctx: BuildCtx,
  preferOverdue: boolean,
): Assembly {
  const rows: AgendaRow[] = []

  // The divider that opens the run. A chunk emits a month divider only where
  // the month actually turns over (walkChunk), but the agenda's first row has
  // always been a month divider — the run starts on a chunk boundary, which is
  // a week start and so essentially never a month start. The week divider
  // needs no such case: a chunk boundary *is* a week start, so the first chunk
  // emits it on its own first day.
  //
  // Keyed off the chunk index it opens (`|lead${first.index}`), not just the
  // month: growing the run backward can prepend a chunk whose own walk hits
  // this same month's true 1st-of-month boundary (see monthDividerRow's own
  // note), at which point this placeholder is gone from the row list, not
  // just re-dated. A bare `m|${monthKey}` key here used to collide with that
  // later, differently-dated divider — same key, so useAnchoredAgendaScroll's
  // exact-key match re-pinned the viewport to it believing it was the same
  // row, and "Load earlier" clicked from the very top silently relabelled the
  // topbar to a different month.
  const first = chunks[0]
  if (first) {
    const firstDay = chunkRange(first.index, ctx.ws).from
    if (monthKeyOf(firstDay) === monthKeyOf(addDays(firstDay, -1))) {
      rows.push(monthDividerRow(firstDay, ctx.today, `|lead${first.index}`))
    }
  }

  // The single point in the walk where Overdue splices in: today, clamped into
  // the loaded run so it still resolves to one end of it (rather than never
  // matching any walked day) when `anchor` is far enough from today that the
  // whole run lands on one side of it.
  let overdueDayKey = ctx.todayKey
  if (overdueSection && chunks.length > 0) {
    const runFrom = chunkRange(chunks[0]!.index, ctx.ws).from
    const runTo = chunkRange(chunks[chunks.length - 1]!.index, ctx.ws).to
    const clamped = Math.max(runFrom.getTime(), Math.min(ctx.todayMs, runTo.getTime()))
    if (clamped !== ctx.todayMs) overdueDayKey = fmtISO(new Date(clamped))
  }

  let overdueRowIndex = -1
  let anchorRowIndex = -1

  for (const chunk of chunks) {
    const base = rows.length
    const spliceAt = overdueSection ? chunk.dayRowStart.get(overdueDayKey) ?? -1 : -1
    // The anchor day always has a section (buildBucket forces one), so a hit
    // here is the row index its content starts at.
    const anchorAt = chunk.buckets.get(ctx.anchorKey)?.section
      ? chunk.dayRowStart.get(ctx.anchorKey) ?? -1
      : -1

    if (spliceAt < 0) {
      if (anchorAt >= 0) anchorRowIndex = base + anchorAt
      for (const r of chunk.rows) rows.push(r)
    } else {
      for (let i = 0; i < spliceAt; i++) rows.push(chunk.rows[i]!)
      overdueRowIndex = rows.length
      for (const r of overdueSection!.rows) rows.push(r)  // spliceAt >= 0 implies overdueSection
      if (anchorAt >= 0) {
        anchorRowIndex = anchorAt < spliceAt ? base + anchorAt : rows.length + (anchorAt - spliceAt)
      }
      for (let i = spliceAt; i < chunk.rows.length; i++) rows.push(chunk.rows[i]!)
    }
  }

  // anchorKey === todayKey (the default, anchor omitted) is the ordinary
  // "scroll to today" case: prefer the overdue section when there is one,
  // else today's own section. A different anchor means an explicit jump to
  // that specific day instead, so it always wins regardless of overdue —
  // surfacing unrelated overdue work isn't what "take me to this day" asked
  // for.
  const goToRowIndex = preferOverdue && overdueRowIndex >= 0 ? overdueRowIndex : anchorRowIndex

  // Mirrors the row assembly above: past days ascending, then overdue, then
  // current/future days ascending — kept in this order (rather than pushing
  // overdue last) so `sections`/`goToIndex` stay meaningful for callers
  // reasoning about chronology independent of the divider rows.
  const sections: Section[] = []
  for (const chunk of chunks) {
    for (const s of chunk.sections) if (s.kind === 'day' && s.dateKey < ctx.todayKey) sections.push(s)
  }
  if (overdueSection) sections.push(overdueSection)
  for (const chunk of chunks) {
    for (const s of chunk.sections) if (!(s.kind === 'day' && s.dateKey < ctx.todayKey)) sections.push(s)
  }

  // goToIndex (section-granular) is kept only for tests/consumers that still
  // reason in terms of sections; goToRowIndex above is what AgendaView uses.
  const goToIndex = overdueSection && preferOverdue
    ? sections.indexOf(overdueSection)
    : sections.findIndex(s => (s.kind === 'day' && s.dateKey === ctx.anchorKey))

  return { rows, goToRowIndex, sections, goToIndex }
}

/** One chunk of the loaded run, as `useAgendaChunks` hands it over. */
export interface AgendaChunkOccs {
  index: number
  occs: Occurrence[]
}

export interface AgendaSectionCache {
  chunkOccs: AgendaChunkOccs[]
  todayMs: number
  anchorMs: number
  nowMs: number
  filterKey: string
  /** The groups the overdue block was built from — see overduePool.ts. */
  overdueGroups: OverdueGroup[]
  /** Whether the overdue section was built collapsed — see calendar/viewState.ts. */
  overdueCollapsed: boolean
  /** Locale week-start (0=Sun, 1=Mon, 6=Sat) — gates week-divider boundaries. */
  ws: 0 | 1 | 6
  /** Per-chunk-index row caches, keyed by absolute chunk index (agendaChunks.ts). */
  chunks: Map<number, ChunkSectionCache>
  /** The run's chunk caches in order — what the assembly memo below compares. */
  ordered: ChunkSectionCache[]
  overdueSection: Section | null
  sections: Section[]
  goToIndex: number
  /** Flattened, week/month-divider-interspersed row list — what AgendaView actually virtualizes. */
  rows: AgendaRow[]
  /** Index into `rows` of the scroll-to-today target's own first row (see `goToIndex`). */
  goToRowIndex: number
}

function sameOrder(a: ChunkSectionCache[], b: ChunkSectionCache[]): boolean {
  // Compares each chunk's `rows` array rather than the cache object: a chunk
  // whose `occs` identity changed but whose layout didn't comes back as
  // `{ ...prev, occs }` — a new wrapper carrying the very same rows. Comparing
  // wrappers would make this memo miss on every done-toggle, which is exactly
  // the once-a-minute-looking-like-a-rebuild the assembly memo exists to stop.
  return a.length === b.length && a.every((c, i) => c.rows === b[i]?.rows)
}

/**
 * The agenda's grouping + sorting + flattening stage: build each loaded
 * chunk's rows (cached per absolute chunk index) and concatenate them into the
 * one ordered row list AgendaView virtualizes.
 *
 * `chunkOccs` arrives from useAgendaChunks as one expanded occurrence array
 * per chunk of the loaded run, ascending and disjoint. Sectioning is chunked
 * for the same reason expansion is: a change confined to one chunk — a
 * done-toggle, an added item, and — once the agenda loads incrementally — a
 * load-more at either end —
 * costs one chunk's rebuild rather than the whole window's. A flat array over
 * the window could not do that: its cache is dropped outright the moment the
 * array's *length* changes, since bucket reuse depends on positional
 * alignment, and prepending shifts every position there is.
 *
 * `anchor` defaults to `today` — the ordinary case, where the seeded/scroll
 * target bucket is today's own and goToIndex prefers the overdue section over
 * it. Passing a different anchor (Agenda re-centered on a day reached via
 * Month/Day) instead seeds that day's bucket and targets it directly, skipping
 * the overdue preference — see assembleAgendaRows' `preferOverdue`.
 *
 * `filterKey` is a serializable description of the calendar filter's *state*
 * (useCalendarFilter), and is what the per-chunk caches key on; `filterOccs`
 * is only ever called, never compared. Keying on the callback's identity
 * instead made every chunk's cache hostage to that `useCallback`'s dep list
 * being both complete and referentially stable.
 *
 * `overdueGroups` arrives ready-made from overduePool.ts rather than being
 * pooled out of the chunks here: the overdue block is deliberately no longer a
 * function of the agenda's window (it was the single largest reason that window
 * had to reach a year back before first paint). It is spliced in at the
 * today/future boundary during assembly and is otherwise inert here — which is
 * why it gates the overdue section's own reuse below and nothing else's. Pass
 * a reference-stable empty array for "no overdue"; a fresh `[]` per call is a
 * cache miss.
 */
export function computeAgendaSections(
  prev: AgendaSectionCache | null,
  chunkOccs: AgendaChunkOccs[],
  overdueGroups: OverdueGroup[],
  today: Date,
  now: Date,
  filterOccs: FilterOccs,
  filterKey: string,
  anchor: Date = today,
  overdueCollapsed = false,
  ws: 0 | 1 | 6 = 1,
): AgendaSectionCache {
  const todayMs = today.getTime()
  const anchorMs = anchor.getTime()
  const nowMs = now.getTime()

  if (prev && prev.chunkOccs === chunkOccs && prev.todayMs === todayMs && prev.anchorMs === anchorMs && prev.nowMs === nowMs && prev.filterKey === filterKey && prev.overdueGroups === overdueGroups && prev.overdueCollapsed === overdueCollapsed && prev.ws === ws) {
    return prev
  }

  const todayKey = fmtISO(today)
  const anchorKey = fmtISO(anchor)
  const ctx: BuildCtx = {
    today, now, todayMs, nowMs, todayKey, anchorKey, anchor,
    anchorChunk: chunkIndexFor(anchor, ws), filterOccs, filterKey, ws,
  }

  // Deliberately NOT gating any chunk's reuse: the overdue pool re-expands on
  // every `items` identity change, so a done-toggle hands us a fresh groups
  // array every time. Gating day-section reuse on it would undo exactly what
  // these caches exist for — one rebuilt chunk per toggle, not the whole run.
  const overdueReusable = prev !== null && prev.overdueGroups === overdueGroups && prev.overdueCollapsed === overdueCollapsed && prev.todayMs === todayMs
  const overdueSection = overdueReusable
    ? prev.overdueSection
    : buildOverdueSection(overdueGroups, todayKey, overdueCollapsed)

  // Rebuilt rather than mutated in place, so chunks that dropped out of the
  // loaded run are evicted with it — the run is the retention policy, exactly
  // as it is for the expansion caches (useAgendaChunks).
  const chunks = new Map<number, ChunkSectionCache>()
  const ordered: ChunkSectionCache[] = []
  for (const { index, occs } of chunkOccs) {
    const next = computeChunkRows(prev?.chunks.get(index) ?? null, index, occs, ctx)
    chunks.set(index, next)
    ordered.push(next)
  }

  const preferOverdue = anchorKey === todayKey

  // Assembly allocates a fresh outer array even when every chunk came back
  // untouched, and useAnchoredAgendaScroll reads `prevRows === rows` as "the
  // list was rebuilt" — so memoize it on the chunk row identities, or the
  // once-a-minute `now` tick would look like a rebuild and re-pin the scroll.
  const assemblyReusable = prev !== null
    && sameOrder(prev.ordered, ordered)
    && prev.overdueSection === overdueSection
    && prev.todayMs === todayMs && prev.anchorMs === anchorMs && prev.ws === ws
  const assembly = assemblyReusable
    ? { rows: prev.rows, goToRowIndex: prev.goToRowIndex, sections: prev.sections, goToIndex: prev.goToIndex }
    : assembleAgendaRows(ordered, overdueSection, ctx, preferOverdue)

  return {
    chunkOccs, todayMs, anchorMs, nowMs, filterKey, overdueGroups, overdueCollapsed, ws,
    chunks, ordered, overdueSection, ...assembly,
  }
}
