import type { StoreItem, Entries, Roots, Occurrence } from '@/types'
import type { EntryKey } from '@/fileIO'
import { isSeries, isTracked } from '@/types'
import { addDays } from '@/format'
import { dayRange, expandWithMultiday, OVERDUE_LOOKBACK_DAYS } from '@/model'
import { occKind } from '@/occView'
import { sortOccs } from './occSort'
import type { FilterOccs } from './useCalendarFilter'

/** A past-dated, undone task occurrence — the agenda's definition of overdue. */
const isOverdue = (o: Occurrence): boolean => occKind(o) === 'task' && !o.metadata.done

/**
 * One row's worth of the overdue section: every overdue occurrence of a single
 * series (or a single standalone task), collapsed into one entry.
 *
 * A `weekly / [mo,we,fr]` task left unfinished for a year generates 156 overdue
 * occurrences; before grouping, each was its own agenda row, and the "Overdue"
 * chip's count was mostly made of them. Grouping turns the section from
 * O(past occurrences) into O(undone task items), and its count into the number
 * of distinct pieces of unfinished work — which is what the number was always
 * meant to convey.
 *
 * The individual occurrences are still reachable by scrolling back to their own
 * days: past days no longer hoist their undone tasks out into this section (see
 * buildBucket in agendaSections.ts).
 */
export interface OverdueGroup {
  /**
   * `occ.ownerId ?? occ.id` — every generated occurrence of one series shares
   * its `ownerId` (types.ts), so a series groups under it and a standalone
   * dated task groups alone with no special case. A file holding two series
   * stays two groups, which is right: they are two separate commitments.
   */
  key: string
  /** The group's oldest overdue occurrence — what its row renders, opens, toggles and swipe-deletes. */
  occ: Occurrence
  /** How many overdue occurrences the group pools; always ≥ 1. */
  count: number
  /** `occ.metadata.jsTime` — the oldest overdue instant, hoisted out so the row carries it without re-deriving. */
  oldest: Date
}

/**
 * The overdue pass's own one-entry cache, mirroring AgendaSectionCache. Held by
 * useAgendaSections' module-level slot and invalidated on the identity of every
 * input — see computeOverduePool.
 */
export interface OverduePoolCache {
  entries: Entries
  roots: Roots
  todayMs: number
  filterOccs: FilterOccs
  /**
   * Each entry's *unfiltered* overdue occurrences, reusable while that `Entry`
   * keeps its reference (the `updateFileOccurrenceMap` rule) so an edit
   * re-expands only the entries it touched.
   */
  perEntry: Map<EntryKey, Occurrence[]>
  groups: OverdueGroup[]
}

/**
 * The items an overdue expansion has to run over.
 *
 * The obvious filter — "undone tracked items" — is wrong, because dropping an
 * item changes what expansion *generates* rather than only what it emits. A
 * series' override children carry `excluded` (suppressing an occurrence) and
 * their own `done` (merged over the series' metadata by expandRange), so
 * filtering out a `done: true` override leaves its parent series free to
 * generate a plain, undone-looking occurrence on that date — a completed task
 * reappearing as overdue, and an excluded date reappearing at all.
 *
 * So the rule is per *series*, not per item:
 *   - a series is kept when it is itself undone, or when any of its override
 *     children is (a series root's `done` is forced to `false` by seriesMeta,
 *     so a `done: true` root only reaches us from hand-edited YAML — but if one
 *     does, an undone override of it is still genuinely overdue);
 *   - every child of a kept series comes along whole, whatever its own
 *     `done`/`excluded`, because that is what makes the expansion agree with
 *     the full-vault one;
 *   - a standalone is kept only when it is itself undone.
 *
 * Everything else — done tasks, events, notes — cannot produce an overdue
 * occurrence and is what makes this pass cheap.
 */
function overdueCandidates(items: StoreItem[]): StoreItem[] {
  const undone = (i: StoreItem): boolean => isTracked(i) && !i.metadata.done

  // Children can appear before their series in `items`, so which series are
  // kept has to be settled before anything is emitted.
  const keptSeriesIds = new Set<string>()
  for (const i of items) {
    if (isSeries(i)) { if (undone(i)) keptSeriesIds.add(i.id) }
    else if (i.ownerId && undone(i)) keptSeriesIds.add(i.ownerId)
  }

  const out: StoreItem[] = []
  for (const i of items) {
    if (isSeries(i)) { if (keptSeriesIds.has(i.id)) out.push(i) }
    else if (i.ownerId) { if (keptSeriesIds.has(i.ownerId)) out.push(i) }
    else if (undone(i)) out.push(i)
  }
  return out
}

/**
 * The overdue section's own pass: expand the overdue candidate items over the
 * whole past lookback, keep what is actually overdue, and group it by series.
 *
 * Deliberately independent of the agenda's expansion window (see
 * OVERDUE_LOOKBACK_DAYS), and incremental per entry: expansion of one entry
 * depends only on that entry, so only entries whose `Entry` reference changed
 * are re-expanded — in one batched call — and a full recompute happens only
 * when the day changes.
 *
 * `prev` is returned by reference whenever every input's identity is unchanged,
 * so the groups array stays stable and computeAgendaSections can reuse the
 * built overdue section wholesale.
 */
export function computeOverduePool(
  prev: OverduePoolCache | null,
  entries: Entries,
  roots: Roots,
  today: Date,
  filterOccs: FilterOccs,
): OverduePoolCache {
  const todayMs = today.getTime()

  if (prev && prev.entries === entries && prev.roots === roots && prev.todayMs === todayMs && prev.filterOccs === filterOccs) {
    return prev
  }

  const reusable = prev && prev.todayMs === todayMs ? prev : null
  const perEntry = new Map<EntryKey, Occurrence[]>()
  const changed: StoreItem[] = []
  for (const [key, entry] of entries) {
    const cached = reusable?.entries.get(key) === entry ? reusable.perEntry.get(key) : undefined
    if (cached) perEntry.set(key, cached)
    else {
      perEntry.set(key, [])
      changed.push(...overdueCandidates(entry.items))
    }
  }

  // Through the end of *yesterday*: overdue is a whole-day notion (the agenda's
  // buckets compare `dateKey < todayKey`), so nothing dated today is overdue no
  // matter how early this morning it was due. dayRange rather than a bare
  // midnight `to`, or every timed occurrence on that last day would be dropped.
  const { from, to } = dayRange(addDays(today, -OVERDUE_LOOKBACK_DAYS), addDays(today, -1))
  for (const occ of expandWithMultiday(changed, roots, from, to)) {
    if (isOverdue(occ)) perEntry.get(occ.entryKey)?.push(occ)
  }

  // A union of per-entry lists is not globally ascending, so each group's
  // oldest is an explicit min rather than "first seen".
  const byKey = new Map<string, OverdueGroup>()
  for (const list of perEntry.values()) {
    for (const occ of filterOccs(list)) {
      const jsTime = occ.metadata.jsTime
      if (!jsTime) continue
      const key = occ.ownerId ?? occ.id
      const group = byKey.get(key)
      if (!group) byKey.set(key, { key, occ, count: 1, oldest: jsTime })
      else {
        group.count++
        if (jsTime < group.oldest) { group.occ = occ; group.oldest = jsTime }
      }
    }
  }

  // Sorted like every other list of occurrences in the calendar — priority,
  // then instant, then title. `today` is a legitimate clock value to pass here
  // and the ordering does not actually depend on it: only isDimmed reads it,
  // and an undone task is never dimmed (see occSort's _sortKey).
  const byRepresentative = new Map([...byKey.values()].map(g => [g.occ, g]))
  const groups = sortOccs([...byRepresentative.keys()], today).flatMap(occ => byRepresentative.get(occ) ?? [])

  return { entries, roots, todayMs, filterOccs, perEntry, groups }
}
