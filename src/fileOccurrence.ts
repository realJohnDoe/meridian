import { startOfToday } from 'date-fns'
import { expandRange, joinFileMeta, parseDateTime, stableOccId } from '@/model'
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
 * Every item in a slug, normalized to a single representative Occurrence and
 * sorted ascending by time. In-window items get their real expanded
 * occurrence(s) from `expandRange`; anything expandRange couldn't reach — an
 * undated standalone, a standalone dated outside the ±3yr window, or a series
 * whose entire expansion falls outside it — gets one synthesized from its own
 * stored date (or no date at all). Every item ends up in this same pool, so
 * `resolveOneSlug` below never needs to special-case standalones vs. series.
 */
function candidateOccurrences(
  fileSlug: string,
  slugItems: StoreItem[],
  roots: Roots,
  AHEAD: Date,
  BACK: Date,
  weekStart: 0 | 1 | 6,
): Occurrence[] {
  const inWindow        = expandRange(slugItems, roots, BACK, AHEAD, weekStart)
  const standaloneIds    = new Set(inWindow.filter(o => !o.ownerId).map(o => o.id))
  const seriesOwnerIds   = new Set(inWindow.filter(o => o.ownerId).map(o => o.ownerId))

  const extra: Occurrence[] = []
  for (const item of slugItems) {
    if (isStandaloneOcc(item) && !standaloneIds.has(item.id)) {
      const jsTime = parseDateTime(item.date, item.time) ?? undefined
      extra.push({ ...item, metadata: { ...joinFileMeta(fileSlug, item.metadata, roots), jsTime } })
    }
    if (isSeries(item) && !seriesOwnerIds.has(item.id)) {
      const jsTime = parseDateTime(item.date, item.time) ?? undefined
      extra.push({
        date:     item.date,
        time:     item.time,
        source:   'explicit' as const,
        fileSlug: item.fileSlug,
        id:       stableOccId(`${item.fileSlug}|${item.id}|anchor`),
        ownerId:  item.id,
        metadata: { ...joinFileMeta(item.fileSlug, item.metadata, roots), jsTime },
      })
    }
  }

  return [...inWindow, ...extra].sort(
    (a, b) => (a.metadata.jsTime?.getTime() ?? 0) - (b.metadata.jsTime?.getTime() ?? 0),
  )
}

/**
 * Per-slug resolution primitive used by `updateFileOccurrenceMap`.
 *
 * Fill order (first match wins — future events, open tasks, past events, done tasks):
 *  1. Nearest upcoming event (no `done` field).
 *  2. Undated open task.
 *  3. Earliest undone task (overdue tasks sort before future ones, since
 *     "earliest" just means smallest date).
 *  4. Most-recent past event.
 *  5. Latest done occurrence (past or future).
 *  6. Anything left (e.g. a note) — the earliest candidate, if any.
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
  const nowMs      = now.getTime()
  const candidates = candidateOccurrences(fileSlug, slugItems, roots, AHEAD, BACK, weekStart)

  // 1. Nearest upcoming event.
  const futureEvent = candidates.find(o => occKind(o) === 'event' && (o.metadata.jsTime?.getTime() ?? 0) >= nowMs)
  if (futureEvent) return futureEvent

  // 2. Undated open task.
  const undatedOpen = candidates.find(o => o.date === '' && occKind(o) === 'task' && !o.metadata.done)
  if (undatedOpen) return undatedOpen

  // 3. Earliest undone task.
  const earliestTask = candidates.find(o => occKind(o) === 'task' && !o.metadata.done)
  if (earliestTask) return earliestTask

  // 4. Most-recent past event.
  const pastEvent = [...candidates].reverse().find(o => occKind(o) === 'event' && (o.metadata.jsTime?.getTime() ?? 0) < nowMs)
  if (pastEvent) return pastEvent

  // 5. Latest done occurrence.
  const latestDone = [...candidates].reverse().find(o => o.metadata.done === true)
  if (latestDone) return latestDone

  // 6. Anything left (e.g. a note) — the earliest candidate, if any.
  return candidates[0] ?? null
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
