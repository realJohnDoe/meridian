import { expandRange, joinFileMeta, stableOccId } from './model/expansion'
import { resolveWikilink, unwrapRef } from './wikilinks'
import { isSeries, isStandaloneOcc } from './types'
import type { Occurrence, StoreItem, Roots } from './types'

/** A flat, file-granular entry for the item picker and search overlay. */
export interface FileEntry {
  fileSlug: string
  title:    string
  tags:     string[]
  items:    string[]
}

/** One FileEntry per file (deduped by fileSlug), sourced entirely from the roots map. */
export function fileEntries(roots: Roots): FileEntry[] {
  const entries: FileEntry[] = []
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

// Single-entry memo keyed on (items, roots) reference identity.
// Zustand replaces both on every setData, so the map recomputes lazily on
// the first read after any mutation and is otherwise returned as a stable
// instance — safe to use as a useMemo dependency.
// Call resetFOMCache() on setData to prevent stale state across vault switches
// and to enable test isolation.
let _fomCache: { items: StoreItem[]; roots: Roots; map: Map<string, Occurrence> } | null = null
export function resetFOMCache(): void { _fomCache = null }

const _3YR_MS = 365 * 3 * 86_400_000

/**
 * Total map of fileSlug → best representative occurrence for every file.
 *
 * Fill order (first write per slug wins):
 *  1. Nearest dated occurrence in the ±3yr window — upcoming first, most-recent
 *     past as fallback. Covers series + dated standalones inside the window.
 *  2. Standalone items not yet filled — undated notes and out-of-window dated
 *     singles. Sourced entirely from real store items; roots used only for the
 *     metadata join.
 *  3. Series with no in-window occurrences — fallback to the series' own anchor
 *     date (the series' stored date/time). Covers recurring items whose schedule
 *     falls entirely outside ±3yr.
 *
 * Replaces both `targetOccurrence` (single-slug) and `targetOccurrenceMap`
 * (batch). All consumers read `.get(slug)` from this one map.
 *
 * **Styling ⟺ behavior invariant:** `resolveWikilink(ref, roots) !== undefined`
 * iff `.get(slug)` is non-null iff the link is rendered `wl` (not `wl-broken`)
 * iff clicking opens the existing item. The total guarantee removes any path
 * where a resolved slug lacks an occurrence.
 */
/**
 * Shared per-slug primitive used by both `fileOccurrenceMap` (batch) and
 * `computeSlugOccurrence` (single-slug warm path).
 *
 * Fill order (first match wins):
 *  1. Nearest upcoming dated occurrence in the ±3yr window.
 *  2. Most-recent past occurrence — unless it is done and an undated open
 *     standalone exists, which is preferred as more actionable.
 *  3. First standalone item (undated note or out-of-window dated single).
 *  4. Series anchor date (series entirely outside the ±3yr window).
 */
function resolveOneSlug(
  fileSlug: string,
  slugItems: StoreItem[],
  roots: Roots,
  now: Date,
  AHEAD: Date,
  BACK: Date,
): Occurrence | null {
  for (const occ of expandRange(slugItems, roots, now, AHEAD)) return occ

  const back = expandRange(slugItems, roots, BACK, now)
  const pastOcc = back[back.length - 1]
  if (pastOcc) {
    if (!pastOcc.metadata.done) return pastOcc
    // Past occurrence is done — prefer an undated open standalone if one exists.
    const undatedOpen = slugItems.find(i => isStandaloneOcc(i) && i.date === '' && !i.metadata.done)
    if (undatedOpen) return { ...undatedOpen, metadata: joinFileMeta(fileSlug, undatedOpen.metadata, roots) } as Occurrence
    return pastOcc
  }

  for (const item of slugItems) {
    if (isStandaloneOcc(item)) return { ...item, metadata: joinFileMeta(fileSlug, item.metadata, roots) } as Occurrence
  }
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

export function fileOccurrenceMap(items: StoreItem[], roots: Roots): Map<string, Occurrence> {
  if (_fomCache && _fomCache.items === items && _fomCache.roots === roots) {
    return _fomCache.map
  }

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

  _fomCache = { items, roots, map }
  return map
}

function computeSlugOccurrence(fileSlug: string, items: StoreItem[], roots: Roots): Occurrence | null {
  const slugItems = items.filter(i => i.fileSlug === fileSlug)
  if (slugItems.length === 0) return null
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return resolveOneSlug(
    fileSlug, slugItems, roots, now,
    new Date(now.getTime() + _3YR_MS),
    new Date(now.getTime() - _3YR_MS),
  )
}

export function warmSlugInFOM(fileSlug: string, items: StoreItem[], roots: Roots): void {
  if (!_fomCache) return
  _fomCache.items = items
  _fomCache.roots = roots
  const occ = computeSlugOccurrence(fileSlug, items, roots)
  if (occ) _fomCache.map.set(fileSlug, occ)
  else     _fomCache.map.delete(fileSlug)
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
