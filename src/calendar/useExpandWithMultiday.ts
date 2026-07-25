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

  // Re-set on every call (not just when the result changed) so the map's
  // insertion order tracks recency of use, keeping the LRU eviction below
  // targeted at windows that are actually stale rather than merely unchanged.
  cacheByWindow.delete(key)
  cacheByWindow.set(key, next)
  if (cacheByWindow.size > MAX_CACHED_WINDOWS) {
    const oldestKey = cacheByWindow.keys().next().value
    if (oldestKey !== undefined) cacheByWindow.delete(oldestKey)
  }

  return next.allOccs
}
