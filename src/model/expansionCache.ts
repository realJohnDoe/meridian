import type { StoreItem, StoreOcc, Roots, Occurrence } from '@/types'
import { isSeries } from '@/types'
import { expandWithMultiday } from './expansion'

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
    if (isSeries(item)) seriesTypeById.set(item.id, item.repeat?.type)
  }

  for (let i = 0; i < a.length; i++) {
    const ai = a[i], bi = b[i]
    if (ai === bi) continue  // same reference → nothing changed

    // Fields present on both RepeatPattern and OccurrenceEntry
    if (ai.id !== bi.id || ai.fileSlug !== bi.fileSlug) return false
    if (ai.date !== bi.date || (ai.time ?? null) !== (bi.time ?? null)) return false

    if (isSeries(ai) && isSeries(bi)) {
      if (JSON.stringify(ai.repeat) !== JSON.stringify(bi.repeat)) return false
      // For after_completion series, done determines when the next occurrence is.
      if (ai.repeat?.type === 'after_completion' && ai.metadata.done !== bi.metadata.done) return false
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

  if (prev && prev.fromMs === fromMs && prev.toMs === toMs && prev.roots === roots && hasSameStructure(prev.items, items)) {
    // Only non-structural metadata changed — find altered items and overlay.
    const changedById = new Map<string, StoreOcc>()
    for (let i = 0; i < items.length; i++) {
      if (items[i] !== prev.items[i] && !isSeries(items[i])) {
        changedById.set(items[i].id, items[i] as StoreOcc)
      }
    }

    if (changedById.size === 0) {
      return { ...prev, items }
    }

    const allOccs = prev.allOccs.map(occ => {
      const changed = changedById.get(occ.id)
      if (!changed) return occ
      return {
        ...occ,
        metadata: {
          ...occ.metadata,
          done:         changed.metadata.done,
          priority:     changed.metadata.priority,
          participants: changed.metadata.participants,
        },
      }
    })
    return { items, roots, fromMs, toMs, allOccs }
  }

  const allOccs = expandWithMultiday(items, roots, from, to)
  return { items, roots, fromMs, toMs, allOccs }
}
