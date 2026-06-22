import { addDays, isSameDay } from 'date-fns'
import { expandRange, joinFileMeta, stableOccId } from './model/expansion'
import { fmtT } from './model/dateUtils'
import { parseDurationDays } from './model/duration'
import { resolveWikilink, unwrapRef } from './wikilinks'
import { occKind, isSeries, isStandaloneOcc } from './types'
import type { Occurrence, StoreItem, Roots } from './types'
import type { OccState } from './components/ui/occurrence-variants'

export { addDays, isSameDay as sameDay }

// ── DATE FORMATTERS ────────────────────────────────────────────

export const fmtLong  = (d: Date): string => d.toLocaleDateString('en-US', { weekday: 'long',  month: 'long',  day: 'numeric' })
export const fmtShort = (d: Date): string => d.toLocaleDateString('en-US', {                   month: 'short', day: 'numeric' })

export function fmtTopBarDay(d: Date, today: Date): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

export function fmtTopBarMonth(d: Date, today: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'long' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

// ── FILE ENTRY HELPERS ─────────────────────────────────────────

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

// ── OCCURRENCE SORT ────────────────────────────────────────────

const _prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

function _sortKey(o: Occurrence): number {
  const state     = occState(o)
  const dimmed    = state === 'done' || state === 'event-past'
  const isEvent   = occKind(o) === 'event'
  const isMultiday = (parseDurationDays(o.metadata.duration) ?? 0) >= 2
  const hasTimed  = !!fmtT(o.time)

  // Active items first (groups 0-3), then past/done in the same sub-order (4-7)
  const base = dimmed ? 4 : 0
  if (isEvent && isMultiday) return base + 0   // multiday events
  if (isEvent && !hasTimed)  return base + 1   // untimed single-day events
  if (isEvent &&  hasTimed)  return base + 2   // timed events
  return base + 3                              // tasks
}

function _prioKey(o: Occurrence): number {
  return o.metadata.priority ? (_prioOrder[o.metadata.priority] ?? 3) : 3
}

export function sortOccs(arr: Occurrence[]): Occurrence[] {
  return [...arr].sort((a: Occurrence, b: Occurrence) => {
    const sd = _sortKey(a) - _sortKey(b); if (sd) return sd
    const pd = _prioKey(a) - _prioKey(b); if (pd) return pd
    const ta = a.metadata.jsTime?.getTime() ?? 0
    const tb = b.metadata.jsTime?.getTime() ?? 0
    if (ta !== tb) return ta - tb
    return (a.metadata.title || '').localeCompare(b.metadata.title || '')
  })
}

// ── OCCURRENCE STATE → CSS ─────────────────────────────────────

export function occState(o: Occurrence): OccState {
  if (o.metadata.done) return 'done'
  const kind = occKind(o)
  if (kind === 'note') return 'note'
  if (kind === 'task' || o.metadata.done !== undefined) {
    const p = o.metadata.priority
    if (p === 'high')   return 'task-p1'
    if (p === 'medium') return 'task-p2'
    if (p === 'low')    return 'task-p3'
    return 'task-open'
  }
  if ((parseDurationDays(o.metadata.duration) ?? 0) >= 2) {
    // Use day-level comparison: past days of a multiday event get the gray shader,
    // today and future days stay purple.
    if (o.metadata.jsTime) {
      const today  = new Date(); today.setHours(0, 0, 0, 0)
      const day    = new Date(o.metadata.jsTime); day.setHours(0, 0, 0, 0)
      if (day < today) return 'event-past'
    }
    return 'event-future'
  }
  const now = new Date()
  if (o.metadata.jsTime && o.metadata.jsTime < now) {
    // Whole-day events (no time) use day-level comparison — they stay colored
    // until midnight, not until 00:01 AM when jsTime (midnight) < now.
    if (!o.time) {
      const today    = new Date(); today.setHours(0, 0, 0, 0)
      const eventDay = new Date(o.metadata.jsTime); eventDay.setHours(0, 0, 0, 0)
      if (eventDay >= today) return 'event-future'
    }
    return 'event-past'
  }
  return 'event-future'
}
