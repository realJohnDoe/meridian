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
 * Shared per-slug resolution primitive for `fileOccurrenceMap`.
 *
 * Fill order (first match wins — all open before all done):
 *  1. Nearest upcoming undone dated occurrence in the ±3yr window.
 *  2. Most-recent overdue occurrence (past undone).
 *  3. Undated open standalone.
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
): Occurrence | null {
  const t0 = performance.now()
  let step = 1

  // 1. Nearest upcoming undone occurrence.
  for (const occ of expandRange(slugItems, roots, now, AHEAD)) {
    if (!occ.metadata.done) {
      const ms = performance.now() - t0
      if (ms > 2) console.log(`[perf:fom]   resolveOneSlug(${fileSlug}) step${step}: ${ms.toFixed(2)}ms`)
      return occ
    }
  }

  // 2. Most-recent overdue occurrence (past undone).
  step = 2
  const back = expandRange(slugItems, roots, BACK, now)
  const pastUndone = [...back].reverse().find(o => !o.metadata.done)
  if (pastUndone) {
    const ms = performance.now() - t0
    if (ms > 2) console.log(`[perf:fom]   resolveOneSlug(${fileSlug}) step${step}: ${ms.toFixed(2)}ms`)
    return pastUndone
  }

  // 3. Undated open standalone.
  step = 3
  const undatedOpen = slugItems.find(i => isStandaloneOcc(i) && i.date === '' && !i.metadata.done)
  if (undatedOpen) {
    const ms = performance.now() - t0
    if (ms > 2) console.log(`[perf:fom]   resolveOneSlug(${fileSlug}) step${step}: ${ms.toFixed(2)}ms`)
    return { ...undatedOpen, metadata: joinFileMeta(fileSlug, undatedOpen.metadata, roots) } as Occurrence
  }

  // 4. Most-recent past done occurrence.
  step = 4
  const pastDone = back[back.length - 1]
  if (pastDone) {
    const ms = performance.now() - t0
    if (ms > 2) console.log(`[perf:fom]   resolveOneSlug(${fileSlug}) step${step}: ${ms.toFixed(2)}ms`)
    return pastDone
  }

  // 5. Any upcoming done occurrence.
  step = 5
  for (const occ of expandRange(slugItems, roots, now, AHEAD)) {
    const ms = performance.now() - t0
    if (ms > 2) console.log(`[perf:fom]   resolveOneSlug(${fileSlug}) step${step}: ${ms.toFixed(2)}ms`)
    return occ
  }

  // 6. Any standalone (undated done or out-of-window dated single).
  step = 6
  for (const item of slugItems) {
    if (isStandaloneOcc(item)) {
      const ms = performance.now() - t0
      if (ms > 2) console.log(`[perf:fom]   resolveOneSlug(${fileSlug}) step${step}: ${ms.toFixed(2)}ms`)
      return { ...item, metadata: joinFileMeta(fileSlug, item.metadata, roots) } as Occurrence
    }
  }

  // 7. Series anchor date.
  step = 7
  for (const item of slugItems) {
    if (!isSeries(item)) continue
    const ms = performance.now() - t0
    if (ms > 2) console.log(`[perf:fom]   resolveOneSlug(${fileSlug}) step${step}: ${ms.toFixed(2)}ms`)
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

/** Total map of fileSlug → best representative occurrence for every file. */
export function fileOccurrenceMap(items: StoreItem[], roots: Roots): Map<string, Occurrence> {
  const now   = new Date(); now.setHours(0, 0, 0, 0)
  const AHEAD = new Date(now.getTime() + _3YR_MS)
  const BACK  = new Date(now.getTime() - _3YR_MS)
  const map = new Map<string, Occurrence>()

  const bySlug = new Map<string, StoreItem[]>()
  for (const item of items) {
    let group = bySlug.get(item.fileSlug)
    if (!group) { group = []; bySlug.set(item.fileSlug, group) }
    group.push(item)
  }
  for (const [slug, slugItems] of bySlug) {
    const occ = resolveOneSlug(slug, slugItems, roots, now, AHEAD, BACK)
    if (occ) map.set(slug, occ)
  }

  return map
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
): Map<string, Occurrence> {
  const t0  = performance.now()
  const now   = new Date(); now.setHours(0, 0, 0, 0)
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

  let reused = 0, dirty = 0
  const dirtySlugMs: string[] = []

  const map = new Map<string, Occurrence>()
  for (const [slug, slugItems] of newBySlug) {
    const prevGroup    = prevBySlug.get(slug)
    const rootSame     = prevRoots.get(slug) === roots.get(slug)
    const groupSame    = prevGroup !== undefined
      && prevGroup.length === slugItems.length
      && prevGroup.every((item, i) => item === slugItems[i])

    if (rootSame && groupSame) {
      const cached = prevFom.get(slug)
      if (cached !== undefined) { map.set(slug, cached); reused++; continue }
    }

    dirty++
    const tSlug = performance.now()
    const occ = resolveOneSlug(slug, slugItems, roots, now, AHEAD, BACK)
    dirtySlugMs.push(`${slug}(${(performance.now() - tSlug).toFixed(1)}ms)`)
    if (occ) map.set(slug, occ)
  }

  const total = performance.now() - t0
  console.log(
    `[perf:fom] updateFom: ${total.toFixed(2)}ms | total=${newBySlug.size} reused=${reused} dirty=${dirty}`,
    dirty > 0 ? `| re-resolved: ${dirtySlugMs.join(', ')}` : '',
  )

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
