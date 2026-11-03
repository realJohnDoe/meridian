import type { StoreItem, StoreOcc, StoreSeries, Roots, Occurrence, FileMetadata } from '@/types'
import { isSeries } from '@/types'
import { expandWithMultiday } from './expansion'
import { buildItemIndex, type ItemIndex } from './itemIndex'
import { parseDateString, parseDateTime } from './dateUtils'

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
 * the new values are overlaid directly onto the cached occurrences. When the
 * structure changed, only the changed entries are re-expanded (see
 * `reexpandChangedEntries`).
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

    // Only the occurrences actually touched by a changed item/file/series
    // move — everything else stays the same reference. Gated on entryKey
    // first: an entry's occurrences share one entryKey string, so that lookup
    // hashes once per entry, where a per-occurrence id would hash every
    // occurrence. Item ids embed their entryKey (parseToStoreItems), so no
    // change reaches outside its own entry.
    const changedKeys = new Set<string>(changedFileMeta.keys())
    for (const item of [...changedById.values(), ...changedSeriesById.values()]) changedKeys.add(item.entryKey)
    const allOccs = prev.allOccs.map(occ => {
      if (!changedKeys.has(occ.entryKey)) return occ
      const changedItem = changedById.get(occ.id)
      const changedFile = changedFileMeta.get(occ.entryKey)
      const changedSeries = occ.ownerId ? changedSeriesById.get(occ.ownerId) : undefined
      if (!changedItem && !changedFile && !changedSeries) return occ
      const override = changedSeries ? overrideById.get(occ.id) : undefined
      return {
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
    })
    return { items, roots, fromMs, toMs, allOccs }
  }

  const sameWindow = prev && prev.fromMs === fromMs && prev.toMs === toMs
  const allOccs = (sameWindow ? reexpandChangedEntries(prev, items, roots, from, to) : null)
    ?? expandWithMultiday(items, roots, from, to, itemIndexFor(items))
  return { items, roots, fromMs, toMs, allOccs }
}

/**
 * The structural path: re-expands only the entries whose items or root
 * changed, keeps every other entry's occurrences by reference (so row memos
 * hold), and merges the two sorted lists into exactly the order a full
 * `expandWithMultiday` over `items` would produce. Returns `null` — "do the
 * full expansion" — when too much changed for this to be worth it.
 *
 * Keyed by entryKey, not occurrence id: a multiday standalone emits one
 * occurrence per covered day under one id. Entry granularity is also what
 * keeps a series and its overrides together — `parseToStoreItems` puts both
 * in the same file and derives every item id from its entryKey, so no
 * occurrence of one entry can depend on, or dedupe against, another's items.
 */
function reexpandChangedEntries(prev: ExpansionCache, items: StoreItem[], roots: Roots, from: Date, to: Date): Occurrence[] | null {
  const prevItems = new Set(prev.items)
  const nextItems = new Set(items)
  const changed = new Set<string>()
  for (const item of items) if (!prevItems.has(item)) changed.add(item.entryKey)
  for (const item of prev.items) if (!nextItems.has(item)) changed.add(item.entryKey)
  if (roots !== prev.roots) {
    for (const [key, meta] of roots) if (prev.roots.get(key) !== meta) changed.add(key)
    for (const key of prev.roots.keys()) if (!roots.has(key)) changed.add(key)
  }
  const changedItems = items.filter(item => changed.has(item.entryKey))
  // A vault load or reload touches most entries; the merge only pays off for a few.
  if (changedItems.length > items.length / 4) return null

  // Unchanged entries' items must keep their relative order in `items`
  // (deriveViews walks the entries Map in insertion order), or `kept` is no
  // longer sorted under the new tie-break ranks and a merge would be silently wrong.
  const keptItems = prev.items.filter(item => !changed.has(item.entryKey))
  let k = 0
  for (const item of items) if (!changed.has(item.entryKey) && item !== keptItems[k++]) return null

  const fresh = expandWithMultiday(changedItems, roots, from, to)
  const kept = prev.allOccs.filter(occ => !changed.has(occ.entryKey))

  // Tie-break between equal jsTimes the way the full path's stable sort does:
  // by emission order — every series' occurrences (in items order), then
  // every standalone's start, then multiday standalones' extra covered days.
  const { series, standalones } = itemIndexFor(items)
  const rankById = new Map<string, number>()
  series.forEach((item, i) => rankById.set(item.id, i))
  standalones.forEach((item, i) => rankById.set(item.id, series.length + i))
  const rank = (occ: Occurrence): number => {
    const r = rankById.get(occ.ownerId ?? occ.id) ?? -1
    const start = parseDateTime(occ.date, occ.time) ?? parseDateString(occ.date)
    return !occ.ownerId && occ.metadata.jsTime!.getTime() !== start?.getTime() ? r + standalones.length : r
  }
  const before = (a: Occurrence, b: Occurrence) =>
    ((a.metadata.jsTime!.getTime() - b.metadata.jsTime!.getTime()) || rank(a) - rank(b)) < 0

  // Binary-search each fresh occurrence's slot in `kept`, so ranks are only
  // computed for the handful of comparisons that land on a tie.
  const merged: Occurrence[] = []
  let next = 0
  for (const occ of fresh) {
    let lo = next, hi = kept.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (before(kept[mid]!, occ)) lo = mid + 1
      else hi = mid
    }
    while (next < lo) merged.push(kept[next++]!)
    merged.push(occ)
  }
  while (next < kept.length) merged.push(kept[next++]!)
  return merged
}
