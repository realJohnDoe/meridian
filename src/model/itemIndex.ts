import type { StoreItem, StoreSeries, StoreOcc } from '@/types'
import { isSeries } from '@/types'

/**
 * A one-time classification of a `StoreItem[]` into the three partitions
 * `expandRange`/`expandWithMultiday` need — series, standalones, and each
 * series' override children keyed by `ownerId`. Building it is what those two
 * functions otherwise do inline on every call: `items.filter(isSeries)`,
 * `items.filter(isStandaloneOcc)`, and, per series, `items.filter(i =>
 * !isSeries(i) && i.ownerId === series.id)` — the last one *inside* the series
 * loop, so it costs O(series × items) per call.
 *
 * `items` here is the store's whole cross-vault item list (see
 * `deriveViews`), not a single entry's own `items` tuple — several call sites
 * share one such array across several expansion windows in the same commit
 * (Month's three panes, Day/Week's five each), which is what makes caching
 * this classification, rather than only the expansion result, worth doing.
 * See `model/expansionCache.ts`'s `itemIndexFor` for that cache.
 */
export interface ItemIndex {
  series: StoreSeries[]
  standalones: StoreOcc[]
  /** Non-series items carrying an `ownerId` (series override children), grouped by that id. */
  childrenByOwnerId: Map<string, StoreOcc[]>
}

export function buildItemIndex(items: StoreItem[]): ItemIndex {
  const series: StoreSeries[] = []
  const standalones: StoreOcc[] = []
  const childrenByOwnerId = new Map<string, StoreOcc[]>()

  for (const item of items) {
    if (isSeries(item)) {
      series.push(item)
    } else if (item.ownerId) {
      const existing = childrenByOwnerId.get(item.ownerId)
      if (existing) existing.push(item)
      else childrenByOwnerId.set(item.ownerId, [item])
    } else {
      standalones.push(item)
    }
  }

  return { series, standalones, childrenByOwnerId }
}
