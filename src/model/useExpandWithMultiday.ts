import { useRef } from 'react'
import type { StoreItem, StoreOcc, Roots, Occurrence } from '@/types'
import { isSeries } from '@/types'
import { expandWithMultiday } from './expansion'

interface Cache {
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
function hasSameStructure(a: StoreItem[], b: StoreItem[]): boolean {
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
      const oa = ai as StoreOcc, ob = bi as StoreOcc
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
  const cacheRef = useRef<Cache | null>(null)
  const c = cacheRef.current

  const fromMs = from.getTime()
  const toMs = to.getTime()

  if (c && c.fromMs === fromMs && c.toMs === toMs && c.roots === roots && hasSameStructure(c.items, items)) {
    // Only non-structural metadata changed — find altered items and overlay.
    const changedById = new Map<string, StoreOcc>()
    for (let i = 0; i < items.length; i++) {
      if (items[i] !== c.items[i] && !isSeries(items[i])) {
        changedById.set(items[i].id, items[i] as StoreOcc)
      }
    }

    if (changedById.size === 0) {
      cacheRef.current = { ...c, items }
      return c.allOccs
    }

    const allOccs = c.allOccs.map(occ => {
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
    cacheRef.current = { items, roots, fromMs, toMs, allOccs }
    return allOccs
  }

  const allOccs = expandWithMultiday(items, roots, from, to)
  cacheRef.current = { items, roots, fromMs, toMs, allOccs }
  return allOccs
}
