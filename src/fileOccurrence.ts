import { expandRange, joinFileMeta, stableOccId } from './model/expansion'
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
  // 1. Nearest upcoming undone occurrence.
  for (const occ of expandRange(slugItems, roots, now, AHEAD)) {
    if (!occ.metadata.done) return occ
  }

  // 2. Most-recent overdue occurrence (past undone).
  const back = expandRange(slugItems, roots, BACK, now)
  const pastUndone = [...back].reverse().find(o => !o.metadata.done)
  if (pastUndone) return pastUndone

  // 3. Undated open standalone.
  const undatedOpen = slugItems.find(i => isStandaloneOcc(i) && i.date === '' && !i.metadata.done)
  if (undatedOpen) return { ...undatedOpen, metadata: joinFileMeta(fileSlug, undatedOpen.metadata, roots) } as Occurrence

  // 4. Most-recent past done occurrence.
  const pastDone = back[back.length - 1]
  if (pastDone) return pastDone

  // 5. Any upcoming done occurrence.
  for (const occ of expandRange(slugItems, roots, now, AHEAD)) return occ

  // 6. Any standalone (undated done or out-of-window dated single).
  for (const item of slugItems) {
    if (isStandaloneOcc(item)) return { ...item, metadata: joinFileMeta(fileSlug, item.metadata, roots) } as Occurrence
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
