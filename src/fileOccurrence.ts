import { startOfToday } from 'date-fns'
import { expandRange, joinFileMeta, stableOccId } from '@/model'
import { buildResolveIndex, unwrapRef } from './wikilinks'
import { isSeries, isStandaloneOcc } from './types'
import { occKind } from './occView'
import { onIdle } from '@/lib/idle'
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
      tags:  meta.tags,
      items: meta.items,
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
): Occurrence | null {
  const nowMs    = now.getTime()
  const inWindow = expandRange(slugItems, roots, BACK, AHEAD) // ascending by time

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

    const occ = resolveOneSlug(slug, slugItems, roots, now, AHEAD, BACK)
    if (occ) map.set(slug, occ)
  }

  return map
}

// ── the memo, and why this is no longer part of setData ────────────────────
//
// `updateFileOccurrenceMap` used to run synchronously inside `setData`, which
// put it between the Dexie read and the agenda's first paint. On a 300-file
// vault that measured ~240 ms — larger than the YAML parse and the agenda's
// whole expansion+grouping stage — because `resolveOneSlug` expands every slug
// over the ±3-year window above, generating ~28.5k occurrences to pick 300
// representatives. See plans/time-to-today.md.
//
// Nothing rendered at cold start reads it. Its consumers are the editor
// (ItemsList, WikilinkPopup, useEntryEditor), the search overlay
// (FileResultsList) and the entry route — all of which mount well after the
// agenda. So the map is derived on demand instead, and merely *warmed* during
// idle time so those consumers almost never pay for it either.

interface FomMemo { items: StoreItem[]; roots: Roots; map: Map<string, Occurrence> }

// A one-entry Map rather than a `let` or a mutable object field, because
// `fileOccurrenceMap` is called during render (via useFileOccurrenceMap): the
// React Compiler's purity check flags both reassigning a module binding and
// writing a property on one, but a `Map.set()` on a const-bound object is the
// pattern useAgendaSections' sectionsCacheSlot already uses and passes.
const FOM_KEY = 'fom'
const fomMemo = new Map<typeof FOM_KEY, FomMemo>()

// Typed empties for the cold-start call below; a bare `new Map()` there infers
// Map<any, any> and trips the no-unsafe-argument rule.
const NO_ITEMS: StoreItem[] = []
const NO_ROOTS: Roots = new Map()
const NO_FOM: Map<string, Occurrence> = new Map()

/**
 * The fileSlug → representative Occurrence map for `items`/`roots`, memoized on
 * their identity. Safe to call during render: repeating the call with the same
 * inputs returns the same Map by reference, so it behaves as a pure derivation.
 *
 * A miss still goes through `updateFileOccurrenceMap`, so it re-resolves only
 * the slugs that actually changed since the last call — the incremental path is
 * unchanged, it just runs on read rather than on write.
 */
export function fileOccurrenceMap(items: StoreItem[], roots: Roots): Map<string, Occurrence> {
  const prev = fomMemo.get(FOM_KEY)
  if (prev && prev.items === items && prev.roots === roots) return prev.map

  const map = updateFileOccurrenceMap(
    prev?.map ?? NO_FOM, prev?.items ?? NO_ITEMS, prev?.roots ?? NO_ROOTS, items, roots,
  )
  fomMemo.set(FOM_KEY, { items, roots, map })
  return map
}

let cancelWarm = (): void => {}

/**
 * Pre-build the map for `items`/`roots` during idle time, so the first
 * consumer to mount gets a memo hit instead of paying the full resolve inline.
 *
 * Called from `setData`. Re-entrant: a newer store write cancels the pending
 * warm-up rather than queueing a second one, so a burst of sync merges does the
 * work once, for the final state.
 */
export function warmFileOccurrenceMap(items: StoreItem[], roots: Roots): void {
  cancelWarm()
  cancelWarm = onIdle(() => { fileOccurrenceMap(items, roots) })
}

/**
 * Build the whole-vault reverse-link index: targetSlug → fileSlugs that link to it.
 * Self-links are excluded and a source is listed at most once per target (matching the
 * old per-target `break`). Resolves each item once through a shared `buildResolveIndex`,
 * so the total build is O(roots · items) — replacing the old per-target `backlinksTo`
 * that was O(roots² · items) per call. Built once per `roots` change and stored on the
 * Zustand store; call sites do an O(1) `backlinks.get(slug)` lookup.
 */
export function buildBacklinkIndex(roots: Roots): Map<string, string[]> {
  const resolve = buildResolveIndex(roots)
  const backlinks = new Map<string, string[]>()
  for (const [fileSlug, meta] of roots) {
    const seen = new Set<string>()
    for (const raw of meta.items) {
      const target = resolve.get(unwrapRef(raw).toLowerCase())
      if (!target || target === fileSlug || seen.has(target)) continue
      seen.add(target)
      const arr = backlinks.get(target)
      if (arr) arr.push(fileSlug)
      else backlinks.set(target, [fileSlug])
    }
  }
  return backlinks
}
