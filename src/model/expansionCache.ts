import type { StoreItem, StoreOcc, StoreSeries, Roots, Occurrence, FileMetadata } from '@/types'
import { isSeries } from '@/types'
import { expandWithMultiday } from './expansion'
import { buildItemIndex, type ItemIndex } from './itemIndex'

// One-slot memo for buildItemIndex(items), keyed by `items` reference.
//
// computeExpansionCache is called once per (fromMs, toMs) window — one
// ExpansionCache per window, in useExpandWithMultiday's own cacheByWindow map
// — so without this, a commit that expands the same `items` over several
// windows (MonthGrid's three panes, DayPane/WeekPane's five each) rebuilds
// the series/standalone/override classification once per window instead of
// once per items identity. A single slot is enough: every such caller shares
// one `items` array per commit, so they all hit the same slot; a genuinely
// different `items` array (a store write) is a different reference and simply
// overwrites it on the next call — no explicit reset needed, unlike
// useExpandWithMultiday's own cacheByWindow, whose invalidation exists to
// stop a *structural* (shape) collision across vaults, which a reference
// check can't produce.
interface ItemIndexMemo { items: StoreItem[]; index: ItemIndex }
const ITEM_INDEX_KEY = 'index'
const itemIndexSlot = new Map<typeof ITEM_INDEX_KEY, ItemIndexMemo>()

function itemIndexFor(items: StoreItem[]): ItemIndex {
  const cached = itemIndexSlot.get(ITEM_INDEX_KEY)
  if (cached && cached.items === items) return cached.index
  const index = buildItemIndex(items)
  itemIndexSlot.set(ITEM_INDEX_KEY, { items, index })
  return index
}

export interface ExpansionCache {
  items: StoreItem[]
  roots: Roots
  fromMs: number
  toMs: number
  allOccs: Occurrence[]
  /**
   * Reverse indices from occurrence identity to positions in `allOccs`, built
   * once per full expansion and carried forward unchanged across overlay
   * passes (positions stay stable — see `hasSameStructure`). These are what
   * let the metadata-overlay fast path in `computeExpansionCache` touch only
   * the affected occurrences instead of walking all of them.
   */
  indexById: Map<string, number[]>
  indexByEntryKey: Map<string, number[]>
  indexByOwnerId: Map<string, number[]>
}

function buildReverseIndex(allOccs: Occurrence[]): Pick<ExpansionCache, 'indexById' | 'indexByEntryKey' | 'indexByOwnerId'> {
  const indexById = new Map<string, number[]>()
  const indexByEntryKey = new Map<string, number[]>()
  const indexByOwnerId = new Map<string, number[]>()
  const push = (map: Map<string, number[]>, key: string, i: number) => {
    const existing = map.get(key)
    if (existing) existing.push(i)
    else map.set(key, [i])
  }
  for (let i = 0; i < allOccs.length; i++) {
    const occ = allOccs[i]!
    push(indexById, occ.id, i)
    push(indexByEntryKey, occ.entryKey, i)
    if (occ.ownerId) push(indexByOwnerId, occ.ownerId, i)
  }
  return { indexById, indexByEntryKey, indexByOwnerId }
}

/**
 * Returns true when `a` and `b` have the same scheduling structure — i.e. only
 * non-structural metadata (done, priority, participants) changed between them.
 * When true the caller can skip re-running expandWithMultiday and instead
 * overlay the new metadata values directly onto the cached expansion result.
 *
 * Fields that ARE structural (trigger re-expansion when they change):
 *   - id, fileSlug, date, time (occurrence identity / position)
 *   - repeat rule (series generation rule)
 *   - excluded (occurrence suppression)
 *   - ownerId (override → series relationship)
 *   - duration (multiday span)
 *   - done on after_completion series/overrides (determines the next occurrence)
 */
export function hasSameStructure(a: StoreItem[], b: StoreItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false

  // Pre-collect repeat types so we can check after_completion overrides below.
  const seriesTypeById = new Map<string, string | undefined>()
  for (const item of b) {
    if (isSeries(item)) seriesTypeById.set(item.id, item.repeat.type)
  }

  for (let i = 0; i < a.length; i++) {
    // Both indices are in range: i < a.length and the lengths were equal-checked above.
    const ai = a[i]!, bi = b[i]!
    if (ai === bi) continue  // same reference → nothing changed

    // Fields present on both RepeatPattern and OccurrenceEntry
    if (ai.id !== bi.id || ai.entryKey !== bi.entryKey) return false
    if (ai.date !== bi.date || (ai.time ?? null) !== (bi.time ?? null)) return false

    if (isSeries(ai) && isSeries(bi)) {
      if (JSON.stringify(ai.repeat) !== JSON.stringify(bi.repeat)) return false
      // For after_completion series, done determines when the next occurrence is.
      if (ai.repeat.type === 'after_completion' && ai.metadata.done !== bi.metadata.done) return false
      if ((ai.metadata.duration ?? '') !== (bi.metadata.duration ?? '')) return false
    } else if (!isSeries(ai) && !isSeries(bi)) {
      const oa = ai, ob = bi
      if (oa.excluded !== ob.excluded) return false
      if (oa.ownerId !== ob.ownerId) return false
      if ((oa.metadata.duration ?? '') !== (ob.metadata.duration ?? '')) return false
      // For after_completion overrides, done determines the next occurrence too.
      if (oa.ownerId && seriesTypeById.get(oa.ownerId) === 'after_completion') {
        if (oa.metadata.done !== ob.metadata.done) return false
      }
    } else {
      return false  // one became a series, the other an occurrence
    }
  }
  return true
}

/**
 * Computes the expansion result for the given inputs, reusing `prev` when the
 * scheduling structure is unchanged instead of re-running expandWithMultiday.
 * When only non-structural metadata (done, priority, participants) changed,
 * the new values are overlaid directly onto the cached occurrences.
 */
export function computeExpansionCache(
  prev: ExpansionCache | null,
  items: StoreItem[],
  roots: Roots,
  from: Date,
  to: Date,
): ExpansionCache {
  const fromMs = from.getTime()
  const toMs = to.getTime()

  if (prev && prev.fromMs === fromMs && prev.toMs === toMs && hasSameStructure(prev.items, items)) {
    if (items === prev.items && roots === prev.roots) return prev

    // Only non-structural metadata changed — find altered items/files and overlay.
    // `roots` identity is deliberately NOT part of the fast-path gate above: a
    // title/tags/body edit on one file allocates a brand-new `roots` map (see
    // storeOps.ts's editedEntry), but that alone is never structural, so it must
    // not force a full re-expansion of every other file's occurrences too.
    const changedById = new Map<string, StoreOcc>()
    // Series (repeat pattern) items whose own metadata changed. Tracked
    // separately from changedById because a series never appears as `occ.id`
    // itself — expandRange synthesizes a distinct id per generated occurrence
    // (see stableOccId in expansion.ts) — so matching has to go through
    // `ownerId` below instead of a direct id lookup.
    const changedSeriesById = new Map<string, StoreSeries>()
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!  // i < items.length
      if (item === prev.items[i]) continue
      if (isSeries(item)) {
        changedSeriesById.set(item.id, item)
      } else {
        changedById.set(item.id, item)
      }
    }

    const changedFileMeta = new Map<string, FileMetadata>()
    if (roots !== prev.roots) {
      for (const [fileSlug, meta] of roots) {
        if (prev.roots.get(fileSlug) !== meta) changedFileMeta.set(fileSlug, meta)
      }
    }

    if (changedById.size === 0 && changedFileMeta.size === 0 && changedSeriesById.size === 0) {
      return { ...prev, items, roots }
    }

    // Overrides of a changed series, keyed by their own id (which is what
    // occurrences generated from an override carry as `occ.id` — see
    // expandRange). occFromAppMeta/occMeta (storeOps.ts) always set
    // done/priority/participants explicitly on an override, even to
    // `undefined`, so an override's metadata fully replaces the series'
    // rather than falling back to it field-by-field — same as the
    // `{ ...series.metadata, ...override.metadata }` merge expandRange
    // itself performs.
    const overrideById = new Map<string, StoreOcc>()
    if (changedSeriesById.size > 0) {
      for (const item of items) {
        if (!isSeries(item) && item.ownerId && changedSeriesById.has(item.ownerId)) {
          overrideById.set(item.id, item)
        }
      }
    }

    // Only the occurrences actually touched by a changed item/file/series need
    // to move — everything else stays the same reference. The reverse indices
    // (built once per full expansion, see buildReverseIndex) resolve exactly
    // which positions those are without walking prev.allOccs.
    const affectedIndices = new Set<number>()
    for (const id of changedById.keys()) {
      for (const i of prev.indexById.get(id) ?? []) affectedIndices.add(i)
    }
    for (const entryKey of changedFileMeta.keys()) {
      for (const i of prev.indexByEntryKey.get(entryKey) ?? []) affectedIndices.add(i)
    }
    for (const ownerId of changedSeriesById.keys()) {
      for (const i of prev.indexByOwnerId.get(ownerId) ?? []) affectedIndices.add(i)
    }

    const allOccs = prev.allOccs.slice()
    for (const i of affectedIndices) {
      const occ = allOccs[i]!
      const changedItem = changedById.get(occ.id)
      const changedFile = changedFileMeta.get(occ.entryKey)
      const changedSeries = occ.ownerId ? changedSeriesById.get(occ.ownerId) : undefined
      const override = changedSeries ? overrideById.get(occ.id) : undefined
      allOccs[i] = {
        ...occ,
        metadata: {
          ...occ.metadata,
          ...(changedFile ? { title: changedFile.title, tags: changedFile.tags, items: changedFile.items, body: changedFile.body } : null),
          ...(changedSeries ? {
            done:         override ? override.metadata.done : changedSeries.metadata.done,
            priority:     override ? override.metadata.priority : changedSeries.metadata.priority,
            participants: override ? override.metadata.participants : changedSeries.metadata.participants,
          } : null),
          ...(changedItem ? {
            done:         changedItem.metadata.done,
            priority:     changedItem.metadata.priority,
            participants: changedItem.metadata.participants,
          } : null),
        },
      }
    }
    // Positions are unchanged (hasSameStructure guarantees alignment) and the
    // occurrences' id/entryKey/ownerId never change here — only metadata does
    // — so the reverse indices themselves stay valid and carry forward as-is.
    return { items, roots, fromMs, toMs, allOccs, indexById: prev.indexById, indexByEntryKey: prev.indexByEntryKey, indexByOwnerId: prev.indexByOwnerId }
  }

  const allOccs = expandWithMultiday(items, roots, from, to, itemIndexFor(items))
  return { items, roots, fromMs, toMs, allOccs, ...buildReverseIndex(allOccs) }
}
