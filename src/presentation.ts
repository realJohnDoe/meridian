import { addDays, isSameDay } from 'date-fns'
import { fmtT, parseDurationDays, expandRange } from './model/expansion'
import { parseWikilinks, resolveWikilink, unwrapRef } from './wikilinks'
import { occKind } from './types'
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

/**
 * Navigate to the right occurrence for a file link.
 *
 * Strategy: pick the **next upcoming** occurrence (jsTime ≥ today); if none,
 * fall back to the **last past** occurrence. Returns `null` for dateless notes.
 */
export function targetOccurrence(fileSlug: string, items: StoreItem[], roots: Roots): Occurrence | null {
  const msDay = 86400000
  const AHEAD = new Date(TODAY.getTime() + 365 * 3 * msDay)
  const BACK  = new Date(TODAY.getTime() - 365 * 3 * msDay)
  const forward = expandRange(items, roots, TODAY, AHEAD).filter(o => o.fileSlug === fileSlug)
  if (forward.length) return forward[0]
  const back = expandRange(items, roots, BACK, TODAY).filter(o => o.fileSlug === fileSlug)
  if (back.length) return back[back.length - 1]
  return null
}

/**
 * Same strategy as targetOccurrence, but for every file in one pass.
 * Expands the vault once forward (±3 years) and once backward, then picks the
 * best occurrence per fileSlug — instead of running a full vault expansion per
 * file. Use this wherever you need a map of fileSlug → best occurrence.
 */
export function targetOccurrenceMap(items: StoreItem[], roots: Roots): Map<string, Occurrence> {
  const msDay = 86400000
  const AHEAD = new Date(TODAY.getTime() + 365 * 3 * msDay)
  const BACK  = new Date(TODAY.getTime() - 365 * 3 * msDay)
  const map = new Map<string, Occurrence>()

  // Forward pass: expandRange returns occurrences in date order, so the first
  // hit per fileSlug is the earliest upcoming occurrence.
  for (const occ of expandRange(items, roots, TODAY, AHEAD)) {
    if (!map.has(occ.fileSlug)) map.set(occ.fileSlug, occ)
  }

  // Backward pass: iterate in reverse so the first hit per fileSlug is the
  // most recent past occurrence. Only fill slugs with no future occurrence.
  const back = expandRange(items, roots, BACK, TODAY)
  for (let i = back.length - 1; i >= 0; i--) {
    const occ = back[i]
    if (!map.has(occ.fileSlug)) map.set(occ.fileSlug, occ)
  }

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
