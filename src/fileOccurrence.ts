import { startOfToday } from 'date-fns'
import { expandRange, joinFileMeta, stableOccId } from '@/model'
import { buildResolveIndex, unwrapRef } from './wikilinks'
import { isSeries, isStandaloneOcc } from './types'
import { occKind } from './occView'
import { onIdle } from '@/lib/idle'
import type { Occurrence, StoreItem, Roots, Entries } from './types'
import type { EntryKey } from './fileIO'

/**
 * A flat, file-granular entry for the item picker and search overlay.
 *
 * Carries both halves of the identity on purpose: `entryKey` is what the store
 * is looked up by, `fileSlug` is the bare slug that goes *into* the file when
 * the picker writes a `[[wikilink]]`. Conflating the two is the whole bug class
 * `EntryKey`'s branding exists to catch, so neither is derived at the call site.
 */
interface FilePickerEntry {
  entryKey: EntryKey
  fileSlug: string
  title:    string
  tags:     string[]
  items:    string[]
}

/**
 * One FilePickerEntry per file, sourced entirely from the roots map.
 *
 * `vaultId` narrows the result to a single vault. Link pickers must pass it —
 * a `[[wikilink]]` resolves only within its own vault (see `resolveWikilink`),
 * so offering another vault's entries would write a link that renders broken.
 * Search deliberately omits it and spans every registered vault.
 */
export function fileEntries(roots: Roots, vaultId?: string): FilePickerEntry[] {
  const entries: FilePickerEntry[] = []
  for (const [entryKey, meta] of roots) {
    if (vaultId !== undefined && meta.vaultId !== vaultId) continue
    entries.push({
      entryKey,
      fileSlug: meta.fileSlug,
      title: meta.title || meta.fileSlug,
      tags:  meta.tags,
      items: meta.items,
    })
  }
  return entries
}


// ── fileOccurrenceMap ──────────────────────────────────────────────────────────

const _3YR_MS = 365 * 3 * 86_400_000

/**
 * Per-key resolution primitive used by `updateFileOccurrenceMap`.
 *
 * Fill order (first match wins — future events, open tasks, past events, done tasks):
 *  1. Nearest upcoming event (dated, no `done` field, in the ±3yr window).
 *  2. Undated open standalone task.
 *  3. Earliest undone task in the ±3yr window (overdue tasks sort before future
 *     ones, since "earliest" just means smallest date).
 *  4. Most-recent past event.
 *  5. Latest done occurrence in the ±3yr window (past or future).
 *  6. Fallback for keys with nothing in the window: the first standalone item
 *     as-is, or — for a series entirely outside the window — a synthetic
 *     occurrence built from the series' own anchor date (RepeatPattern isn't
 *     itself an Occurrence, so expandRange can't hand us one).
 */
function resolveOneKey(
  entryKey: EntryKey,
  keyItems: StoreItem[],
  roots: Roots,
  now: Date,
  AHEAD: Date,
  BACK: Date,
): Occurrence | null {
  const nowMs    = now.getTime()
  const inWindow = expandRange(keyItems, roots, BACK, AHEAD) // ascending by time

  // 1. Nearest upcoming event.
  const futureEvent = inWindow.find(o => occKind(o) === 'event' && (o.metadata.jsTime?.getTime() ?? 0) >= nowMs)
  if (futureEvent) return futureEvent

  // 2. Undated open standalone task.
  const undatedOpen = keyItems.find(i => isStandaloneOcc(i) && i.date === '' && !i.metadata.done)
  if (undatedOpen) {
    return { ...undatedOpen, metadata: joinFileMeta(entryKey, undatedOpen.metadata, roots) } as Occurrence
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
  for (const item of keyItems) {
    if (isStandaloneOcc(item)) {
      return { ...item, metadata: joinFileMeta(entryKey, item.metadata, roots) }
    }
    if (isSeries(item)) {
      return {
        date:     item.date,
        time:     item.time,
        source:   'explicit' as const,
        entryKey: item.entryKey,
        id:       stableOccId(`${item.entryKey}|${item.id}|anchor`),
        ownerId:  item.id,
        metadata: joinFileMeta(item.entryKey, item.metadata, roots),
      }
    }
  }
  return null
}


/**
 * Incremental update of the EntryKey → representative Occurrence map.
 *
 * **Total over the store's entries**, by construction: every entry has at
 * least one item (`Entry['items']` is non-empty), so `resolveOneKey` can always
 * speak for it. A `.get()` miss is therefore a defect rather than an absence.
 *
 * Re-resolves only entries whose `Entry` object actually changed — reusable
 * when `prevEntries.get(key) === entries.get(key)` (reference equality). An
 * entry is one object, so that single check covers both halves at once:
 * `withEntry`/`editedEntry` (model/storeOps.ts) create a new `Entry` reference
 * for a key whenever either its root or its items change, and leave every
 * other key's reference untouched.
 */
export function updateFileOccurrenceMap(
  prevFom:     Map<EntryKey, Occurrence>,
  prevEntries: Entries,
  entries:     Entries,
  roots:       Roots,
): Map<EntryKey, Occurrence> {
  const now   = startOfToday()
  const AHEAD = new Date(now.getTime() + _3YR_MS)
  const BACK  = new Date(now.getTime() - _3YR_MS)

  const map = new Map<EntryKey, Occurrence>()
  for (const [key, entry] of entries) {
    if (prevEntries.get(key) === entry) {
      const cached = prevFom.get(key)
      if (cached !== undefined) { map.set(key, cached); continue }
    }

    const occ = resolveOneKey(key, entry.items, roots, now, AHEAD, BACK)
    if (occ) map.set(key, occ)
  }

  // No sweep for roots with no items of their own. There used to be one, which
  // synthesized a representative so such an entry had a place in this map at
  // all — a `.get()` miss was read by every consumer as "no entry", which is
  // what left a blank reserved row in the search results and made the entry's
  // own route report "Item not found". `Entry['items']` is non-empty, so every
  // key in the store has items to resolve from and the map is total by
  // construction rather than by an explicit pass.
  return map
}

// ── the memo, and why this is no longer part of setData ────────────────────
//
// `updateFileOccurrenceMap` used to run synchronously inside `setData`, which
// put it between the Dexie read and the agenda's first paint. On a 300-file
// vault that measured ~240 ms — larger than the YAML parse and the agenda's
// whole expansion+grouping stage — because `resolveOneKey` expands every key
// over the ±3-year window above, generating ~28.5k occurrences to pick 300
// representatives.
//
// Nothing rendered at cold start reads it. Its consumers are the editor
// (ItemsList, WikilinkPopup, useEntryEditor), the search overlay
// (FileResultsList) and the entry route — all of which mount well after the
// agenda. So the map is derived on demand instead, and merely *warmed* during
// idle time so those consumers almost never pay for it either.

interface FomMemo { entries: Entries; roots: Roots; map: Map<EntryKey, Occurrence> }

// A one-entry Map rather than a `let` or a mutable object field, because
// `fileOccurrenceMap` is called during render (via useFileOccurrenceMap): the
// React Compiler's purity check flags both reassigning a module binding and
// writing a property on one, but a `Map.set()` on a const-bound object is the
// pattern useAgendaSections' sectionsCacheSlot already uses and passes.
const FOM_KEY = 'fom'
const fomMemo = new Map<typeof FOM_KEY, FomMemo>()

// Typed empty for the cold-start call below; a bare `new Map()` there infers
// Map<any, any> and trips the no-unsafe-argument rule.
const NO_ENTRIES: Entries = new Map()
const NO_FOM: Map<EntryKey, Occurrence> = new Map()

/**
 * The EntryKey → representative Occurrence map for `entries`/`roots`, memoized
 * on their identity. Safe to call during render: repeating the call with the
 * same inputs returns the same Map by reference, so it behaves as a pure
 * derivation.
 *
 * A miss still goes through `updateFileOccurrenceMap`, so it re-resolves only
 * the keys that actually changed since the last call — the incremental path is
 * unchanged, it just runs on read rather than on write.
 */
export function fileOccurrenceMap(entries: Entries, roots: Roots): Map<EntryKey, Occurrence> {
  const prev = fomMemo.get(FOM_KEY)
  if (prev && prev.entries === entries && prev.roots === roots) return prev.map

  const map = updateFileOccurrenceMap(
    prev?.map ?? NO_FOM, prev?.entries ?? NO_ENTRIES, entries, roots,
  )
  fomMemo.set(FOM_KEY, { entries, roots, map })
  return map
}

let cancelWarm = (): void => {}

/**
 * Pre-build the map for `entries`/`roots` during idle time, so the first
 * consumer to mount gets a memo hit instead of paying the full resolve inline.
 *
 * Called from `setData`. Re-entrant: a newer store write cancels the pending
 * warm-up rather than queueing a second one, so a burst of sync merges does the
 * work once, for the final state.
 */
export function warmFileOccurrenceMap(entries: Entries, roots: Roots): void {
  cancelWarm()
  cancelWarm = onIdle(() => { fileOccurrenceMap(entries, roots) })
}

/**
 * Build the reverse-link index across every registered vault: target EntryKey →
 * the EntryKeys that link to it.
 *
 * **Backlinks never cross a vault boundary.** Each root's items are resolved
 * through that root's own vault partition of `buildResolveIndex`, so a
 * `[[weekly-review]]` in the Work vault contributes a backlink to Work's
 * weekly-review and nothing else — even when Personal has a file by the same
 * slug. That falls out of the identity change rather than being a feature.
 *
 * Self-links are excluded and a source is listed at most once per target
 * (matching the old per-target `break`). Resolves each item once through a
 * shared `buildResolveIndex`, so the total build is O(roots · items) —
 * replacing the old per-target `backlinksTo` that was O(roots² · items) per
 * call. Built once per `roots` change and stored on the Zustand store; call
 * sites do an O(1) `backlinks.get(key)` lookup.
 */
export function buildBacklinkIndex(roots: Roots): Map<EntryKey, EntryKey[]> {
  const resolve = buildResolveIndex(roots)
  const backlinks = new Map<EntryKey, EntryKey[]>()
  for (const [entryKey, meta] of roots) {
    const inVault = resolve.get(meta.vaultId)
    if (!inVault) continue
    const seen = new Set<EntryKey>()
    for (const raw of meta.items) {
      const target = inVault.get(unwrapRef(raw).toLowerCase())
      if (!target || target === entryKey || seen.has(target)) continue
      seen.add(target)
      const arr = backlinks.get(target)
      if (arr) arr.push(entryKey)
      else backlinks.set(target, [entryKey])
    }
  }
  return backlinks
}
