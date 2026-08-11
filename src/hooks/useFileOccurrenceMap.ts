import { useStore } from '@/store'
import { fileOccurrenceMap } from '@/fileOccurrence'
import type { Occurrence } from '@/types'

/**
 * The fileSlug → representative Occurrence map, derived from the store's
 * current items/roots.
 *
 * Replaces the old `useStore(s => s.fom)`. The map is no longer a store field
 * because building it blocked the agenda's first paint for ~240 ms on a
 * 300-file vault while nothing on screen read it — see fileOccurrence.ts.
 * Reactivity is unchanged: the map is a pure function of items/roots, so
 * subscribing to those re-renders on exactly the same changes.
 *
 * `setData` warms the memo during idle time, so in practice this is a Map
 * lookup rather than a resolve.
 */
export function useFileOccurrenceMap(): Map<string, Occurrence> {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  return fileOccurrenceMap(items, roots)
}
