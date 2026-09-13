import { parseDurationDays, fmtT } from '@/model'
import type { Occurrence } from '@/types'
import { occKind, occState } from '@/occView'

const _prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * `now` defaults to the wall clock for callers with no live-updating value on
 * hand (ItemsList's done/active partition) — see occState's own doc comment
 * for why that's fine there. sortOccs (below) always passes an explicit
 * value instead, since it's the one call site that used to read the clock
 * internally and broke callers who needed a memo-safe, dependency-tracked
 * sort (see AgendaView).
 */
export function isDimmed(o: Occurrence, now: Date = new Date()): boolean {
  const state = occState(o, now)
  return state === 'done' || state === 'event-past'
}

export function priorityRank(priority: string | undefined): number {
  return priority ? (_prioOrder[priority] ?? 3) : 3
}

// Type sub-order (0-3) within a bucket — multiday events, then untimed
// single-day events, then timed events, then tasks/notes (which carry no
// type distinction of their own, so priority/time/title decide between them).
// Exported so other contexts that sort a mix of occurrences and non-occurrence
// rows (ItemsList) can assign the same key to the occurrences among them —
// see SortKey below.
export function typeKey(o: Occurrence): number {
  const isEvent    = occKind(o) === 'event'
  const isMultiday = (parseDurationDays(o.metadata.duration) ?? 0) >= 2
  const hasTimed   = !!fmtT(o.time)

  if (isEvent && isMultiday) return 0   // multiday events
  if (isEvent && !hasTimed)  return 1   // untimed single-day events
  if (isEvent &&  hasTimed)  return 2   // timed events
  return 3                              // tasks / notes
}

/**
 * The decorated sort key `sortOccs` compares on, factored out so a caller
 * that has to interleave occurrences with rows that aren't occurrences at all
 * (ItemsList: plain checklist-text tasks, broken wikilinks) can build the same
 * shape for those rows — via `occSortKey` for the occurrence ones and by hand
 * for the rest — and sort the combined array with one `compareSortKeys`,
 * rather than maintaining a second, drifting copy of the ordering rule.
 * `bucket` is the primary grouping (active vs dimmed in `sortOccs`; ItemsList
 * adds a third for links that don't resolve to a file at all).
 */
export interface SortKey {
  bucket:   number
  typeKey:  number
  prioKey:  number
  jsTimeMs: number
  title:    string
}

export function compareSortKeys(a: SortKey, b: SortKey): number {
  const bd = a.bucket - b.bucket; if (bd) return bd
  const td = a.typeKey - b.typeKey; if (td) return td
  const pd = a.prioKey - b.prioKey; if (pd) return pd
  if (a.jsTimeMs !== b.jsTimeMs) return a.jsTimeMs - b.jsTimeMs
  return a.title.localeCompare(b.title)
}

export function occSortKey(o: Occurrence, now: Date): SortKey {
  return {
    bucket:   isDimmed(o, now) ? 1 : 0,
    typeKey:  typeKey(o),
    prioKey:  priorityRank(o.metadata.priority),
    jsTimeMs: o.metadata.jsTime?.getTime() ?? 0,
    title:    o.metadata.title || '',
  }
}

/**
 * `now` is required and must be a value the caller can honestly stand behind
 * (a ticking clock, or a provably clock-independent placeholder — see the
 * call sites in BacklogView/NotesView). It used to default to `new Date()`
 * internally via isDimmed→occState, which made this function impure and
 * forced its callers into a phantom memo dependency (see AgendaView's
 * history) just to force a periodic re-sort.
 *
 * Decorates each item with its sort key up front (one occState/occKind/
 * parseDuration pass per item) instead of recomputing it inside the
 * comparator on every pairwise comparison (~2·n·log n calls otherwise).
 *
 * Total order: active (open/future) items first, then dimmed (done/past)
 * ones — but *within* each of those two buckets, the same rule applies:
 * type, then priority, then time, then title. A done task keeps the spot
 * its priority/time would give it among other done items, rather than
 * being demoted to an alphabetical afterthought.
 */
export function sortOccs(arr: Occurrence[], now: Date): Occurrence[] {
  const decorated = arr.map(occ => ({ occ, key: occSortKey(occ, now) }))
  decorated.sort((a, b) => compareSortKeys(a.key, b.key))
  return decorated.map(d => d.occ)
}
