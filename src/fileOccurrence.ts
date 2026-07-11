import { startOfToday } from 'date-fns'
import { expandRange, joinFileMeta, stableOccId } from '@/model'
import { resolveWikilink, unwrapRef } from './wikilinks'
import { isSeries, isStandaloneOcc } from './types'
import type { Occurrence, StoreItem, Roots } from './types'

/** A flat, file-granular entry for the item picker and search overlay. */
interface FilePickerEntry {
  fileSlug: string
  title:    string
  tags:     string[]
  items:    string[]
}

/** One FilePickerEntry per file (deduped by fileSlug), sourced entirely from the roots map. */
export function fileEntries(roots: Roots): FilePickerEntry[] {
  const entries: FilePickerEntry[] = []
  for (const [fileSlug, meta] of roots) {
    entries.push({
      fileSlug,
      title: meta.title || fileSlug,
      tags:  meta.tags  || [],
      items: meta.items || [],
    })
  }
  return entries
}


// ── fileOccurrenceMap ──────────────────────────────────────────────────────────

const _3YR_MS = 365 * 3 * 86_400_000

/**
 * Per-slug resolution primitive used by `updateFileOccurrenceMap`.
 *
 * Fill order (first match wins — future events, open tasks, past events, done tasks):
 *  1. Nearest upcoming undone dated occurrence in the ±3yr window.
 *  2. Undated open standalone.
 *  3. Most-recent overdue occurrence (past undone).
 *  4. Most-recent past done occurrence.
 *  5. Any upcoming done occurrence.
 *  6. First standalone item (undated done or out-of-window dated single).
 *  7. Series anchor date (series entirely outside the ±3yr window).
 */
function resolveOneSlug(
  fileSlug: string,
  slugItems: StoreItem[],
  roots: Roots,
  now: Date,
  AHEAD: Date,
  BACK: Date,
  weekStart: 0 | 1 | 6,
): Occurrence | null {
  // 1. Nearest upcoming undone occurrence.
  for (const occ of expandRange(slugItems, roots, now, AHEAD, weekStart)) {
    if (!occ.metadata.done) return occ
  }

  // 2. Undated open standalone.
  const undatedOpen = slugItems.find(i => isStandaloneOcc(i) && i.date === '' && !i.metadata.done)
  if (undatedOpen) {
    return { ...undatedOpen, metadata: joinFileMeta(fileSlug, undatedOpen.metadata, roots) } as Occurrence
  }

  // 3. Most-recent overdue occurrence (past undone).
  const back = expandRange(slugItems, roots, BACK, now, weekStart)
  const pastUndone = [...back].reverse().find(o => !o.metadata.done)
  if (pastUndone) return pastUndone

  // 4. Most-recent past done occurrence.
  const pastDone = back[back.length - 1]
  if (pastDone) return pastDone

  // 5. Any upcoming done occurrence.
  for (const occ of expandRange(slugItems, roots, now, AHEAD, weekStart)) {
    return occ
  }

  // 6. Any standalone (undated done or out-of-window dated single).
  for (const item of slugItems) {
    if (isStandaloneOcc(item)) {
      return { ...item, metadata: joinFileMeta(fileSlug, item.metadata, roots) }
    }
  }

  // 7. Series anchor date.
  for (const item of slugItems) {
    if (!isSeries(item)) continue
    return {
      date:     item.date,
      time:     item.time,
      source:   'explicit' as const,
      fileSlug: item.fileSlug,
      id:       stableOccId(`${item.fileSlug}|${item.id}|anchor`),
      ownerId:  item.id,
      metadata: joinFileMeta(item.fileSlug, item.metadata, roots),
    }
  }
  return null
}


/**
 * Incremental update of the fileSlug → representative Occurrence map.
 *
 * Re-resolves only slugs whose items group or root entry actually changed.
 * A slug's entry is reusable when:
 *   - its items group has the same length and the same element references, AND
 *   - prevRoots.get(slug) === roots.get(slug)  (reference equality)
 *
 * Mutation helpers (upsertOverride, updateRoot, …) create new object references
 * only for the touched slug(s), so reference checks correctly identify exactly
 * what changed without deep comparison.
 */
export function updateFileOccurrenceMap(
  prevFom:   Map<string, Occurrence>,
  prevItems: StoreItem[],
  prevRoots: Roots,
  items:     StoreItem[],
  roots:     Roots,
  weekStart: 0 | 1 | 6 = 1,
): Map<string, Occurrence> {
  const now   = startOfToday()
  const AHEAD = new Date(now.getTime() + _3YR_MS)
  const BACK  = new Date(now.getTime() - _3YR_MS)

  // Group previous items by slug for reference comparison.
  const prevBySlug = new Map<string, StoreItem[]>()
  for (const item of prevItems) {
    let group = prevBySlug.get(item.fileSlug)
    if (!group) { group = []; prevBySlug.set(item.fileSlug, group) }
    group.push(item)
  }

  // Group new items by slug and build the updated map.
  const newBySlug = new Map<string, StoreItem[]>()
  for (const item of items) {
    let group = newBySlug.get(item.fileSlug)
    if (!group) { group = []; newBySlug.set(item.fileSlug, group) }
    group.push(item)
  }

  const map = new Map<string, Occurrence>()
  for (const [slug, slugItems] of newBySlug) {
    const prevGroup    = prevBySlug.get(slug)
    const rootSame     = prevRoots.get(slug) === roots.get(slug)
    const groupSame    = prevGroup !== undefined
      && prevGroup.length === slugItems.length
      && prevGroup.every((item, i) => item === slugItems[i])

    if (rootSame && groupSame) {
      const cached = prevFom.get(slug)
      if (cached !== undefined) { map.set(slug, cached); continue }
    }

    const occ = resolveOneSlug(slug, slugItems, roots, now, AHEAD, BACK, weekStart)
    if (occ) map.set(slug, occ)
  }

  return map
}

/**
 * Returns the fileSlugs of all files whose items list includes a link to `targetSlug`.
 * Self-links are excluded. Memoize the result on [roots] at the call site.
 */
export function backlinksTo(targetSlug: string, roots: Roots): string[] {
  const result: string[] = []
  for (const [fileSlug, meta] of roots) {
    if (fileSlug === targetSlug) continue
    for (const raw of meta.items ?? []) {
      const ref = unwrapRef(raw)
      if (resolveWikilink(ref, roots) === targetSlug) { result.push(fileSlug); break }
    }
  }
  return result
}
