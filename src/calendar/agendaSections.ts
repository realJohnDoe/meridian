import type { Occurrence } from '@/types'
import { occKind } from '@/occView'
import { fmtISO } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'

const isOverdue = (o: Occurrence) => occKind(o) === 'task' && !o.metadata.done

// Size estimates for the virtualizer. Real sizes are measured after render
// (measureElement); accurate estimates just keep the scrollbar/scrollToIndex
// stable before a section has been measured. initialMeasurementsCache means
// returning users always get real sizes — estimates only matter on first visit.
//
// HEADER_H: DaySection header div — pt-3.5 (14) + pb-1.5 (6) + text-xs line (~20) ≈ 40px
// ROW_H:    OccurrenceCard min-h-11 + py-2 padding + OccurrenceRow mb-1.5 (6) ≈ 68px
// Update these if the header/card padding changes in DaySection.tsx / OccurrenceCard.tsx.
const HEADER_H = 40
const ROW_H = 68

export type Section =
  | { kind: 'day'; key: string; dateKey: string; date: Date; isToday: boolean; isTomorrow: boolean; items: Occurrence[] }
  | { kind: 'overdue'; key: string; items: Occurrence[] }

export function estimateSection(s: Section): number {
  return HEADER_H + s.items.length * ROW_H
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
  nowMs: number
  filterOccs: FilterOccs
  buckets: Map<string, DayBucket>
  /** All bucket keys, ascending — stable while the grouping is reused. */
  sortedKeys: string[]
  /** `keyByIndex[i]` is the day key of `allOccs[i]`, or undefined when it has no jsTime. */
  keyByIndex: (string | undefined)[]
  overdueSection: Section | null
  sections: Section[]
  goToIndex: number
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
  tomorrow: Date
  now: Date
  todayKey: string
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
      section: items.length
        ? { kind: 'day', key: b.key, dateKey: b.key, date: b.date, isToday: false, isTomorrow: false, items }
        : null,
    }
  }

  const items = sortOccs(filtered, ctx.now)
  return {
    ...b,
    overdue: EMPTY_OCCS,
    section: items.length || b.key === ctx.todayKey
      ? {
          kind: 'day', key: b.key, dateKey: b.key, date: b.date,
          isToday: sameDay(b.date, ctx.today),
          isTomorrow: sameDay(b.date, ctx.tomorrow),
          items,
        }
      : null,
  }
}

/** Bucket every occurrence by its calendar day, seeding today so it always exists. */
function groupByDay(allOccs: Occurrence[], today: Date, todayKey: string) {
  const buckets = new Map<string, DayBucket>()
  const keyByIndex = new Array<string | undefined>(allOccs.length)

  buckets.set(todayKey, {
    key: todayKey,
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    isPast: false,
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
 * Unchanged `Section` objects are returned by reference, which is what keeps
 * DaySection's memo from re-rendering days the toggle didn't touch.
 */
export function computeAgendaSections(
  prev: AgendaSectionCache | null,
  allOccs: Occurrence[],
  today: Date,
  now: Date,
  filterOccs: FilterOccs,
): AgendaSectionCache {
  const todayMs = today.getTime()
  const nowMs = now.getTime()

  if (prev && prev.allOccs === allOccs && prev.todayMs === todayMs && prev.nowMs === nowMs && prev.filterOccs === filterOccs) {
    return prev
  }

  const todayKey = fmtISO(today)
  const ctx: BuildCtx = { today, tomorrow: addDays(today, 1), now, todayKey, filterOccs }

  // `today` gates grouping reuse because it decides both the seeded bucket and
  // each bucket's isPast flag.
  const changed = prev && prev.todayMs === todayMs ? changedIndices(prev.allOccs, allOccs) : null
  const sectionsReusable = changed !== null && prev !== null && prev.nowMs === nowMs && prev.filterOccs === filterOccs

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

    // Nothing moved and nothing else changed — hand back the same sections array
    // so AgendaView's virtualizer and scroll listener don't see a new identity.
    if (sectionsReusable && touched.size === 0) {
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
    ({ buckets, keyByIndex, sortedKeys } = groupByDay(allOccs, today, todayKey))
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
  if (sectionsReusable && !pastDirty && prev !== null) {
    overdueSection = prev.overdueSection
  } else {
    const pooled: Occurrence[] = []
    for (const k of sortedKeys) {
      if (k >= todayKey) break
      const b = buckets.get(k)
      if (b) pooled.push(...b.overdue)
    }
    overdueSection = pooled.length ? { kind: 'overdue', key: '__overdue__', items: sortOccs(pooled, now) } : null
  }

  // Flatten: past day-sections (ascending) → overdue → current/future days.
  const sections: Section[] = []
  for (const k of sortedKeys) {
    if (k >= todayKey) break
    const s = buckets.get(k)?.section
    if (s) sections.push(s)
  }
  // goToday scrolls to the overdue section when there is one, else to today.
  let goToIndex = -1
  if (overdueSection) {
    goToIndex = sections.length
    sections.push(overdueSection)
  }
  for (const k of sortedKeys) {
    if (k < todayKey) continue
    const s = buckets.get(k)?.section
    if (!s) continue
    if (goToIndex < 0 && s.kind === 'day' && s.isToday) goToIndex = sections.length
    sections.push(s)
  }

  return { allOccs, todayMs, nowMs, filterOccs, buckets, sortedKeys, keyByIndex, overdueSection, sections, goToIndex }
}
