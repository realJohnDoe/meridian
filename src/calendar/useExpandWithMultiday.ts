import { useRef } from 'react'
import type { StoreItem, Roots, Occurrence } from '@/types'
import { computeExpansionCache, type ExpansionCache } from '@/model'

/**
 * Cached expansion hook. Calls expandWithMultiday once per structural change,
 * and overlays non-structural metadata (done, priority, participants) onto the
 * cached result when only those fields change — avoiding a full re-expansion on
 * every done-toggle or priority edit.
 */
export function useExpandWithMultiday(
  items: StoreItem[],
  roots: Roots,
  from: Date,
  to: Date,
): Occurrence[] {
  const cacheRef = useRef<ExpansionCache | null>(null)
  cacheRef.current = computeExpansionCache(cacheRef.current, items, roots, from, to)
  return cacheRef.current.allOccs
}
