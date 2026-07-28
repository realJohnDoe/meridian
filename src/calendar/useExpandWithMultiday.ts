import { useEffect } from 'react'
import type { StoreItem, Roots, Occurrence } from '@/types'
import { computeExpansionCache, weekStartsOn, type ExpansionCache } from '@/model'
import { useStore } from '@/store'

// MonthGrid keeps three panes (prev/current/next month) alive at once, and
// DayPane's carousel does the same for days, so several distinct (from, to)
// windows are live simultaneously alongside the agenda's own window — a
// single shared slot would thrash between them. Keying by window lets every
// caller share one cache without evicting each other's entries every render.
// Capped so months/days scrolled past and forgotten don't accumulate forever.
const MAX_CACHED_WINDOWS = 12

const cacheByWindow = new Map<string, ExpansionCache>()

function windowKey(fromMs: number, toMs: number, weekStart: 0 | 1 | 6): string {
  return `${fromMs}:${toMs}:${weekStart}`
}

/**
 * Drops every cached window's expansion. Call when `items`/`roots` are about
 * to mean something entirely different — notably on vault change, where
 * structural comparison against the old vault's cached entries is pointless
 * (and, if items happen to collide in shape, could otherwise reuse stale
 * occurrences from the vault that just deactivated).
 */
export function resetExpansionCache(): void {
  cacheByWindow.clear()
}

/**
 * Cached expansion hook. Calls expandWithMultiday once per structural change
 * per (from, to, weekStart) window, and overlays non-structural metadata
 * (done, priority, participants) onto the cached result when only those
 * fields change — avoiding a full re-expansion on every done-toggle or
 * priority edit.
 *
 * The cache lives in a module-level map keyed by window, not component state:
 * navigating away from and back to the agenda (or month/day panes remounting)
 * previously discarded the cache on unmount, paying the full re-expansion
 * every time even though the underlying data hadn't changed.
 */
export function useExpandWithMultiday(
  items: StoreItem[],
  roots: Roots,
  from: Date,
  to: Date,
): Occurrence[] {
  const weekStart = useStore(s => weekStartsOn(s.localePrefs))
  const key = windowKey(from.getTime(), to.getTime(), weekStart)

  const prev = cacheByWindow.get(key) ?? null
  const next = computeExpansionCache(prev, items, roots, from, to, weekStart)

  // Value write, render phase. Safe here because it's idempotent:
  // computeExpansionCache returns `prev` by reference when nothing changed, so
  // repeating this write (StrictMode double-render) or skipping it (React
  // Compiler memoizing this block on items/roots/from/to/weekStart) can't
  // produce a wrong value. `set` on an existing key also leaves the map's
  // insertion order alone, so this deliberately does NOT touch recency.
  cacheByWindow.set(key, next)

  // Recency write, commit phase. This one is order-dependent, so it can't live
  // in render: the compiler memoizes the block above, and callers whose window
  // is reference-stable across renders (useAgendaSections memoizes from/to on
  // `today`) would then skip the touch entirely on unrelated re-renders — the
  // agenda's minute tick, a filter change — and the LRU would start evicting
  // windows that are in active use rather than ones that are actually stale.
  // Intentionally no dep array: "recency of use" means every commit that used
  // this window, which is the closest honest equivalent of the old
  // every-render touch now that "every render" is not something a compiled
  // component can promise. Both operations are O(1).
  useEffect(() => {
    // delete+set rather than set alone: `set` on an existing key keeps its
    // original position, and moving `key` to the end is the whole point. Also
    // re-inserts the entry if another window's eviction dropped it meanwhile.
    cacheByWindow.delete(key)
    cacheByWindow.set(key, next)
    if (cacheByWindow.size > MAX_CACHED_WINDOWS) {
      // Can't hit the entry just re-inserted above — it's now the newest, and
      // the map only overflows at sizes well above one.
      const oldestKey = cacheByWindow.keys().next().value
      if (oldestKey !== undefined) cacheByWindow.delete(oldestKey)
    }
  })

  return next.allOccs
}
