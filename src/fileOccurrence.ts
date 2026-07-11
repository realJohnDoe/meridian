import { startOfToday } from 'date-fns'
import { expandRange, joinFileMeta, stableOccId } from '@/model'
import { resolveWikilink, unwrapRef } from './wikilinks'
import { isSeries, isStandaloneOcc } from './types'
import { occKind } from './occView'
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
 *  1. Nearest upcoming event (dated, no `done` field, in the ±3yr window).
 *  2. Undated open standalone task.
 *  3. Earliest undone task in the ±3yr window (overdue tasks sort before future
 *     ones, since "earliest" just means smallest date).
 *  4. Most-recent past event.
 *  5. Latest done occurrence in the ±3yr window (past or future).
 *  6. Fallback for slugs with nothing in the window: the first standalone item
 *     as-is, or — for a series entirely outside the window — a synthetic
 *     occurrence built from the series' own anchor date (RepeatPattern isn't
 *     itself an Occurrence, so expandRange can't hand us one).
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
  const nowMs    = now.getTime()
  const inWindow = expandRange(slugItems, roots, BACK, AHEAD, weekStart) // ascending by time

  // 1. Nearest upcoming event.
  const futureEvent = inWindow.find(o => occKind(o) === 'event' && (o.metadata.jsTime?.getTime() ?? 0) >= nowMs)
  if (futureEvent) return futureEvent

  // 2. Undated open standalone task.
  const undatedOpen = slugItems.find(i => isStandaloneOcc(i) && i.date === '' && !i.metadata.done)
  if (undatedOpen) {
    return { ...undatedOpen, metadata: joinFileMeta(fileSlug, undatedOpen.metadata, roots) } as Occurrence
  }

  // 3. Earliest undone task.
  const earliestTask = inWindow.find(o => occKind(o) === 'task' && !o.metadata.done)
  if (earliestTask) return earliestTask

  // 4. Most-recent past event.
  const pastEvent = [...inWindow].reverse().find(o => occKind(o) === 'event' && (o.metadata.jsTime?.getTime() ?? 0) < nowMs)
  if (pastEvent) return pastEvent

  // 5. Latest done occurrence.
  const latestDone = [...inWindow].reverse().find(o => o.metadata.done === true)
  if (latestDone) return latestDone

  // 6. Fallback: standalone as-is, or a synthesized anchor for an out-of-window series.
  for (const item of slugItems) {
    if (isStandaloneOcc(item)) {
      return { ...item, metadata: joinFileMeta(fileSlug, item.metadata, roots) }
    }
    if (isSeries(item)) {
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
