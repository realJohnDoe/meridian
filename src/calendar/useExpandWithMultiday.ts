import { useState } from 'react'
import type { StoreItem, Roots, Occurrence } from '@/types'
import { computeExpansionCache, type ExpansionCache } from '@/model'

/**
 * Cached expansion hook. Calls expandWithMultiday once per structural change,
 * and overlays non-structural metadata (done, priority, participants) onto the
 * cached result when only those fields change — avoiding a full re-expansion on
 * every done-toggle or priority edit.
 *
 * The cache lives in state rather than a ref: computeExpansionCache always
 * returns a fresh wrapper object, but its `allOccs` field is reference-stable
 * whenever nothing actually changed, so gating the state update on that field
 * avoids re-rendering when the expansion is unchanged.
 */
export function useExpandWithMultiday(
  items: StoreItem[],
  roots: Roots,
  from: Date,
  to: Date,
): Occurrence[] {
  const [cache, setCache] = useState<ExpansionCache | null>(null)
  const next = computeExpansionCache(cache, items, roots, from, to)
  if (next.allOccs !== cache?.allOccs) {
    setCache(next)
  }
  return next.allOccs
}
