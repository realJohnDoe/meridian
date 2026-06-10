import { addDays, isSameDay } from 'date-fns'
import { fmtT, parseDurationDays, expandRange, joinFileMeta, stableOccId } from './model/expansion'
import { parseWikilinks, resolveWikilink, unwrapRef } from './wikilinks'
import { occKind, isSeries, isStandaloneOcc } from './types'
import { getRoots } from './storeBridge'
import type { Occurrence, StoreItem, Roots } from './types'
import { TODAY } from './constants'

export { addDays, isSameDay as sameDay }

// ── DATE FORMATTERS ────────────────────────────────────────────

export const fmtLong  = (d: Date): string => d.toLocaleDateString('en-US', { weekday: 'long',  month: 'long',  day: 'numeric' })
export const fmtShort = (d: Date): string => d.toLocaleDateString('en-US', {                   month: 'short', day: 'numeric' })

// ── FILE ENTRY HELPERS ─────────────────────────────────────────

/** A flat, file-granular entry for the item picker and search overlay. */
export interface FileEntry {
  fileSlug: string
  title:    string
  tags:     string[]
  topics:   string[]
}

/** One FileEntry per file (deduped by fileSlug), sourced entirely from the roots map. */
export function fileEntries(roots: Roots): FileEntry[] {
  const entries: FileEntry[] = []
  for (const [fileSlug, meta] of roots) {
    entries.push({
      fileSlug,
      title:  meta.title || fileSlug,
      tags:   (meta.tags   as string[]) || [],
      topics: (meta.topics as string[]) || [],
    })
  }
  return entries
}

// ── fileOccurrenceMap ──────────────────────────────────────────────────────────

// Single-entry memo keyed on (items, roots) reference identity.
// Zustand replaces both on every setData, so the map recomputes lazily on
// the first read after any mutation and is otherwise returned as a stable
// instance — safe to use as a useMemo dependency.
let _fomCache: { items: StoreItem[]; roots: Roots; map: Map<string, Occurrence> } | null = null

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
export function fileOccurrenceMap(items: StoreItem[], roots: Roots): Map<string, Occurrence> {
  if (_fomCache && _fomCache.items === items && _fomCache.roots === roots) {
    return _fomCache.map
  }

  const AHEAD = new Date(TODAY.getTime() + _3YR_MS)
  const BACK  = new Date(TODAY.getTime() - _3YR_MS)
  const map = new Map<string, Occurrence>()

  // Step 1: dated occurrences in the ±3yr window.
  // expandRange is date-ordered; first hit per slug = nearest upcoming.
  for (const occ of expandRange(items, roots, TODAY, AHEAD)) {
    if (!map.has(occ.fileSlug)) map.set(occ.fileSlug, occ)
  }
  // Backward pass: most-recent past fallback for files with no future occurrence.
  const back = expandRange(items, roots, BACK, TODAY)
  for (let i = back.length - 1; i >= 0; i--) {
    const occ = back[i]
    if (!map.has(occ.fileSlug)) map.set(occ.fileSlug, occ)
  }

  // Step 2: standalone items not yet filled (undated notes, out-of-window singles).
  for (const item of items) {
    if (!isStandaloneOcc(item) || map.has(item.fileSlug)) continue
    map.set(item.fileSlug, {
      ...item,
      metadata: joinFileMeta(item.fileSlug, item.metadata, roots),
    } as Occurrence)
  }

  // Step 3: series with no in-window occurrences — use the series' anchor date.
  for (const item of items) {
    if (!isSeries(item) || map.has(item.fileSlug)) continue
    map.set(item.fileSlug, {
      date:     item.date,
      time:     item.time,
      source:   'explicit' as const,
      fileSlug: item.fileSlug,
      id:       stableOccId(`${item.fileSlug}|${item.id}|anchor`),
      ownerId:  item.id,
      metadata: joinFileMeta(item.fileSlug, item.metadata, roots),
    })
  }

  _fomCache = { items, roots, map }
  return map
}

/**
 * Returns the fileSlugs of all files whose topics include a link to `targetSlug`.
 * Self-links are excluded. Memoize the result on [roots] at the call site.
 */
export function backlinksTo(targetSlug: string, roots: Roots): string[] {
  const result: string[] = []
  for (const [fileSlug, meta] of roots) {
    if (fileSlug === targetSlug) continue
    for (const raw of (meta.topics as string[] | undefined) ?? []) {
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
  return arr.sort((a: Occurrence, b: Occurrence) => {
    const sd = _sortKey(a) - _sortKey(b); if (sd) return sd
    const pd = _prioKey(a) - _prioKey(b); if (pd) return pd
    const td = (a.metadata.jsTime?.getHours() || 0) * 60 + (a.metadata.jsTime?.getMinutes() || 0)
             - (b.metadata.jsTime?.getHours() || 0) * 60 - (b.metadata.jsTime?.getMinutes() || 0)
    if (td) return td
    return (a.metadata.title || '').localeCompare(b.metadata.title || '')
  })
}

// ── OCCURRENCE STATE → CSS ─────────────────────────────────────

export function occState(o: Occurrence): string {
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

// ── State → class maps ─────────────────────────────────────────
// Each view that needs colour classes derived from occState should
// add a map here rather than fork the state logic elsewhere.

/** Agenda / MonthView colour-bar classes. */
const _ccBarMap: Record<string, string> = {
  'done':         'done',
  'event-past':   'done',
  'note':         'note',
  'task-open':    'task',
  'task-p1':      'task-p1',
  'task-p2':      'task-p2',
  'task-p3':      'task-p3',
  'event-future': 'event',
}

export function ccBarClass(o: Occurrence): string {
  if ((parseDurationDays(o.metadata.duration) ?? 0) >= 2) return 'multiday'
  return _ccBarMap[occState(o)] ?? 'event'
}

/** DayView event-block classes (applied as `dv-eblk <class>` / `dv-aditem <class>`).
 *  Notes are undated and never reach expandRange, so 'note' is not listed here. */
const _dvBlkMap: Record<string, string> = {
  'done':         'past',
  'event-past':   'past',
  'task-open':    'task',
  'task-p1':      'task-p1',
  'task-p2':      'task-p2',
  'task-p3':      'task-p3',
  'event-future': 'event',
}

export function occDvClass(o: Occurrence): string {
  return _dvBlkMap[occState(o)] ?? 'event'
}

// ── WIKILINK → HTML ────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildBodyHtml(text: string, roots?: Roots): string {
  const allRoots = roots ?? getRoots()
  const links = parseWikilinks(text)
  if (links.length === 0) return escapeHtml(text).replace(/\n/g, '<br>')

  let result = ''
  let cursor = 0
  for (const wl of links) {
    result += escapeHtml(text.slice(cursor, wl.start)).replace(/\n/g, '<br>')
    const target = resolveWikilink(wl.ref, allRoots)
    const cls      = target ? 'wl' : 'wl-broken'
    const safeRef   = escapeHtml(wl.ref)
    const safeLabel = escapeHtml(wl.label ?? wl.ref)
    result += `<span class="${cls}" data-ref="${safeRef}">[[${safeLabel}]]</span>`
    cursor = wl.end
  }
  result += escapeHtml(text.slice(cursor)).replace(/\n/g, '<br>')
  return result
}
