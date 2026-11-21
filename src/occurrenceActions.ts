import { toast } from 'sonner'
import { parseDateString, toggleDone, excludeOccurrence, hasSiblingOccurrences, deletionEndsAfterCompletionSeries, deleteByEntryKey, deleteFollowing, deleteSeries, occFromAppMeta, freeEntryKey, moveEntryKey } from '@/model'
import { occIsRecur } from './occView'
import { isStandaloneOcc } from './types'
import type { Occurrence, OccurrenceEntry, OccurrenceMetadata, Entries, Entry, StoreItem } from './types'
import { fmtShort } from './format'
import { keySlug, keyVaultId } from './fileIO'
import type { EntryKey } from './fileIO'
import { isWritableVault } from './vaultRef'
import { getSnapshot, getSlugSnapshot, getItems, getEntries, getVaults, setData, replaceFavorite } from './storeBridge'
import { deleteEntity } from './persistencePort'
import { commitNext, commitMove, persistEntries } from './storeCommit'

let _toastId:       string | number | null = null
let _pendingCommit: (() => void) | null    = null
let _stopWatching:  (() => void) | null    = null
let _navArmed = false
// WCAG 2.2.1: long enough to notice a mistaken delete and reach `Undo`.
const TOAST_MS = 10_000
// A delete's own navigation (the editor calls `navigateBack()` right after)
// must not count as the user's next action; see `onNavigationResolved`.
const OWN_NAV_GRACE_MS = 1500

// Restores each of `keys`' items/root from `snapshot` into the *current*
// store, rather than reverting the whole store — an edit made to another
// file while the undo toast was up must survive. The restored slugs are then
// re-persisted so the cache/backend agree with the reverted store.
//
// Takes a list rather than one key so a delete's backlink cleanup (see
// `deleteByEntryKey`'s `affectedKeys`) can be undone in the same call as the
// primary file — restoring only the primary key would put the deleted entry
// back while leaving every other file's wikilink to it stripped, which is the
// half of finding #7 that was specific to Undo (the missing persistence was
// the other half, fixed at the two `beginSwipeDelete` call sites below).
function restoreEntries(snapshot: { entries: Entries }, entryKeys: readonly EntryKey[]): void {
  const keys = new Set(entryKeys)
  const entries = new Map(getSnapshot().entries)
  for (const key of keys) {
    const was = snapshot.entries.get(key)
    // Restoring an entry restores it whole, and an entry the snapshot never had
    // is restored to *absent* — one decision per key instead of two that could
    // disagree about whether the entry is back.
    if (was) entries.set(key, was)
    else entries.delete(key)
  }
  const restored = { entries }
  setData(entries)
  // Undoing a create restores an entry that was never there — `persistEntries`
  // reads absence as the delete it is, rather than leaving the file the create
  // already wrote behind on disk.
  persistEntries(restored, keys)
}

// `label` is a ready-made message for a delete narrower than the whole entry,
// so the toast says how much went; without it the whole entry did. Undated
// occurrences have no date to name, so they fall back to the plain message.
const scoped = (o: Occurrence, fmt: (date: string) => string): string | undefined => {
  const d = parseDateString(o.date)
  return d ? fmt(fmtShort(d)) : undefined
}
const onDate   = (o: Occurrence) => scoped(o, d => `Deleted ${o.metadata.title} on ${d}`)
const fromDate = (o: Occurrence) => scoped(o, d => `Deleted ${o.metadata.title} from ${d} on`)

// Runs and clears the pending commit and forgets the toast's watchers.
function settleDelete(): void {
  _stopWatching?.(); _stopWatching = null
  _toastId = null
  const commit = _pendingCommit
  _pendingCommit = null
  commit?.()
}

/**
 * Persists a pending delete now and closes its toast without committing twice.
 * For page teardown (`pagehide`), where the toast's own timer never gets to run.
 */
export function flushPendingDelete(): void {
  const id = _toastId
  settleDelete()
  if (id !== null) toast.dismiss(id)
}

/**
 * Call once per resolved route navigation. The first one after a delete is
 * ignored when it is the delete's own (the editor's `navigateBack()`); any
 * later one is the user's next action and commits the delete.
 */
export function onNavigationResolved(): void {
  if (_toastId === null) return
  if (!_navArmed) { _navArmed = true; return }
  flushPendingDelete()
}

function showDeleteToast(
  title: string,
  commitFn: () => void,
  undoFn: () => void,
  opts?: { endsSeries?: boolean; label?: string },
): void {
  flushPendingDelete()

  _pendingCommit = commitFn
  _navArmed = false
  const graceTimer = setTimeout(() => { _navArmed = true }, OWN_NAV_GRACE_MS)
  const message = opts?.endsSeries
    ? `Deleted: ${title} — this series only repeats after completion, so it ends here.`
    : opts?.label ?? `Deleted: ${title}`
  const toastFn = opts?.endsSeries ? toast.warning : toast
  const show = (duration: number) => toastFn(message, {
    id: _toastId ?? undefined,
    duration,
    action: {
      label: 'Undo',
      onClick: () => {
        _pendingCommit = null
        settleDelete()
        undoFn()
      },
    },
    // Only the current toast settles: a replaced one's late callback must not
    // commit (or unwatch) its successor.
    onDismiss: () => { if (_pendingCommit === commitFn) settleDelete() },
    onAutoClose: () => { if (_pendingCommit === commitFn) settleDelete() },
  })
  _toastId = show(TOAST_MS)

  // Sonner pauses on hover and a hidden page but not on keyboard focus, so a
  // screen-reader user who reached the toast (alt+T) would still lose it.
  const inToast = (e: FocusEvent) => e.target instanceof Element && !!e.target.closest('[data-sonner-toaster]')
  const onFocusIn = (e: FocusEvent) => { if (inToast(e)) show(Infinity) }
  const onFocusOut = (e: FocusEvent) => { if (inToast(e)) show(TOAST_MS) }
  const doc = typeof document === 'undefined' ? null : document
  doc?.addEventListener('focusin', onFocusIn)
  doc?.addEventListener('focusout', onFocusOut)
  _stopWatching = () => {
    clearTimeout(graceTimer)
    doc?.removeEventListener('focusin', onFocusIn)
    doc?.removeEventListener('focusout', onFocusOut)
  }
}

export function toggleOccDone(o: Occurrence): void {
  const snapshot = getSnapshot()
  const next = toggleDone(snapshot, o)
  commitNext(next, [o.entryKey])
}

// Re-opens a done, undated occurrence: reuses an existing undated entry for
// the file if one exists, otherwise creates a fresh undated entry.
export function reopenOcc(occ: Occurrence): void {
  const entries = getEntries()
  const entry = entries.get(occ.entryKey)
  if (!entry) return
  const withItems = (items: Entry['items']): void => {
    commitNext({ entries: new Map(entries).set(occ.entryKey, { ...entry, items }) }, [occ.entryKey])
  }
  const [head, ...tail] = entry.items
  const existingUndated = entry.items.find(
    i => isStandaloneOcc(i) && i.date === '',
  ) as OccurrenceEntry<OccurrenceMetadata> | undefined

  if (existingUndated) {
    const reopen = (i: StoreItem): StoreItem => i.id === existingUndated.id
      ? { ...existingUndated, metadata: { ...existingUndated.metadata, done: false } }
      : i
    withItems([reopen(head), ...tail.map(reopen)])
  } else {
    const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
      date:     '',
      time:     null,
      source:   'explicit',
      entryKey: occ.entryKey,
      id:       crypto.randomUUID(),
      metadata: { ...occFromAppMeta(occ.metadata), done: false },
    }
    withItems([head, ...tail, newOcc])
  }
}

/**
 * Move one entry into another vault, store and backends together.
 *
 * Returns the key it landed on — not necessarily the same slug it had: the
 * target vault may already own that slug, in which case `freeEntryKey`
 * allocates `slug-2`, `slug-3`, … exactly as a new entry would, rather than
 * writing over an unrelated file. Callers need the result to navigate: the
 * entry's URL is its key, so it changes with the move.
 *
 * Null when there is nothing to do (the entry is already in that vault),
 * nothing to move (no root under `fromKey`), or nowhere to move it (the target
 * isn't a registered writable vault). The last check is a duplicate of the
 * one the port makes against the mounted backend, on purpose: the port refuses
 * *after* the store has been re-keyed, which would leave the entry showing in a
 * vault whose file was never written. Checking the registry here keeps the
 * common case — a vault removed while the confirm dialog was open — from
 * getting that far.
 */
export function moveEntryToVault(fromKey: EntryKey, toVaultId: string): EntryKey | null {
  if (keyVaultId(fromKey) === toVaultId) return null
  if (!isWritableVault(getVaults().find(v => v.id === toVaultId))) return null
  const snapshot = getSlugSnapshot()
  if (!snapshot.entries.has(fromKey)) return null

  const toKey = freeEntryKey(snapshot, toVaultId, keySlug(fromKey))
  commitMove(moveEntryKey(snapshot, fromKey, toKey), fromKey, toKey)
  // The entry's identity changed, so anything that stored the old one has to
  // follow it. Favourites are the only such list: `backlinks` and the
  // occurrence map are derived and rebuild off the new merge on their own.
  replaceFavorite(fromKey, toKey)
  return toKey
}

export function beginSwipeDelete(o: Occurrence): () => void {
  const snapshot = getSnapshot()
  const title    = o.metadata.title
  let cancelled  = false

  // A standalone occurrence with live siblings is removed on its own, like a
  // recurring one; only the entry's last occurrence takes the file with it
  // (mirrors `deleteNode` in editor/save.ts).
  if (occIsRecur(o) || hasSiblingOccurrences(getItems(), o)) {
    const next = excludeOccurrence(snapshot, o)
    const endsSeries = deletionEndsAfterCompletionSeries(snapshot.entries.get(o.entryKey)?.items ?? [], o)
    showDeleteToast(title,
      // Serialized when the toast settles, not when it was armed: `next` is
      // only committed by the apply below, and an unrelated edit may have
      // landed on this entry in between.
      () => { persistEntries(getSnapshot(), [o.entryKey]) },
      () => { cancelled = true; restoreEntries(snapshot, [o.entryKey]) },
      { endsSeries, label: onDate(o) },
    )
    return () => { if (!cancelled) setData(next.entries) }
  } else {
    // deleteByEntryKey's backlink cleanup — the OTHER files whose `items:`
    // list pointed at this one — is captured here so the deferred commit and
    // Undo (defined below, but not run until later: on toast auto-close, a
    // forced early commit from a second swipe-delete, or an Undo click) can
    // reach it without recomputing it from whatever the store happens to look
    // like when they fire. Genuinely unknown until apply() actually runs
    // (below): it recomputes from a FRESH snapshot, deliberately, so a
    // concurrent edit to some other file during the exit animation is not
    // silently reverted by writing back a stale one — see the identical
    // reasoning already governing `next` here for the recurring branch above.
    let affectedKeys: EntryKey[] = []
    showDeleteToast(title,
      () => { persistEntries(getSnapshot(), affectedKeys); deleteEntity(o.entryKey) },
      () => {
        cancelled = true
        if (!getItems().find(i => i.id === o.id)) restoreEntries(snapshot, [o.entryKey, ...affectedKeys])
      },
    )
    return () => {
      if (cancelled) return
      const { data, affectedKeys: computed } = deleteByEntryKey(getSnapshot(), o.entryKey)
      affectedKeys = computed
      setData(data.entries)
    }
  }
}

// ── Editor delete paths (issue #1128) ───────────────────────────────────────
//
// Same deferred-commit/undo shape as `beginSwipeDelete` above, minus the
// swipe animation: the editor has nothing to time the store update against,
// so `setData` runs immediately here and only the persist/backend write (and
// therefore Undo) waits on the toast.

/** "Delete this occurrence" — a series' single instance, or a standalone sharing its file with other content. */
export function deleteOccurrenceWithUndo(o: Occurrence): void {
  const snapshot = getSnapshot()
  const next = excludeOccurrence(snapshot, o)
  const endsSeries = deletionEndsAfterCompletionSeries(snapshot.entries.get(o.entryKey)?.items ?? [], o)
  setData(next.entries)
  showDeleteToast(o.metadata.title,
    () => { persistEntries(getSnapshot(), [o.entryKey]) },
    () => { restoreEntries(snapshot, [o.entryKey]) },
    { endsSeries, label: onDate(o) },
  )
}

/** "Delete this and following" — caps the series' repeat.end. */
export function deleteFutureWithUndo(o: Occurrence): void {
  const snapshot = getSnapshot()
  const next = deleteFollowing(snapshot, o)
  setData(next.entries)
  showDeleteToast(o.metadata.title,
    () => { persistEntries(getSnapshot(), [o.entryKey]) },
    () => { restoreEntries(snapshot, [o.entryKey]) },
    { label: fromDate(o) },
  )
}

/**
 * "Delete all occurrences" — only reachable when the series isn't
 * the file's only content (see `deleteSeries`'s doc comment in model/); a
 * lone series goes through `deleteWholeFileWithUndo` instead, for the
 * backlink cleanup a file that vanishes needs.
 */
export function deleteSeriesWithUndo(o: Occurrence): void {
  const snapshot = getSnapshot()
  const next = deleteSeries(snapshot, o)
  setData(next.entries)
  showDeleteToast(o.metadata.title,
    () => { persistEntries(getSnapshot(), [o.entryKey]) },
    () => { restoreEntries(snapshot, [o.entryKey]) },
    { label: `Deleted all of ${o.metadata.title}` },
  )
}

/**
 * Delete an entire file: the lone-standalone case, an explicit "Delete whole
 * file" choice, or "all occurrences" when a series is all the file holds.
 * Reuses `deleteByEntryKey`'s backlink cleanup and restores both the primary
 * entry and every backlink-edited file on Undo — the same restoration
 * `beginSwipeDelete`'s non-recurring branch already relies on.
 */
export function deleteWholeFileWithUndo(entryKey: EntryKey, title: string): void {
  const snapshot = getSnapshot()
  const { data: next, affectedKeys } = deleteByEntryKey(snapshot, entryKey)
  setData(next.entries)
  showDeleteToast(title,
    () => { persistEntries(getSnapshot(), affectedKeys); deleteEntity(entryKey) },
    () => { restoreEntries(snapshot, [entryKey, ...affectedKeys]) },
  )
}

