import { cacheGetRecord } from '@/storage/cache/files'
import { onCacheChange } from '@/storage/cache/broadcast'
import { getInFlightPaths } from '@/storage/inFlight'
import { pathToKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { getBackend } from './backends'
import { mergeChangedIntoStore } from './sync'
import { updateSyncUI } from './syncUI'

// ── CROSS-TAB COHERENCE ───────────────────────────────────────
//
// Two views of one vault (two tabs, or a tab plus the installed PWA) share one
// Dexie database and nothing else. `sync.ts`'s ordinary machinery already
// handles a *second device* correctly — its cache is its own, so its push CASes
// against a token the backend has moved past and `resolveCollision` runs. A
// second view is the case none of that machinery can see: it inherits the very
// `version` the first view's push just wrote into the shared row, so its
// compare-and-swap passes against content it has never seen and the first
// view's edit is gone, silently (data-integrity survey 2026-09-05, finding #2).
//
// The fix is not more conflict detection — it is not letting the second view's
// store go stale in the first place. `cache/broadcast.ts` announces every row
// whose content changed; this folds those rows back in through
// `mergeChangedIntoStore`, the same seam `reconcileWithBackend` (sync.ts) uses,
// so a cross-tab change arrives by exactly the path a pulled change does: one
// vault's layer, parse failures reported, round trip audited. The editor's
// `touchedFieldsOnly` then does the rest — the next save writes only what this
// view's user actually touched, over content that is now current.

/**
 * Announcements arrive one row at a time (an autosave, a checkbox, a push
 * marking a batch clean), and each fold re-parses and re-writes a whole vault
 * layer. Buffering a beat coalesces a burst — a bulk pull in the other tab, a
 * run of keystrokes — into one fold, at a delay no one can perceive.
 */
const CROSS_TAB_COALESCE_MS = 60

const _pendingCrossTab = new Map<string, Set<string>>()
let _crossTabTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Re-read the rows another view just wrote, and fold them into this view's
 * store.
 *
 * `getInFlightPaths` is the trap this has to step around. It is per-process
 * bookkeeping, so it says nothing about the other tab — but it does say that
 * *this* tab has a write for that path between its store update and its Dexie
 * row, and folding the row in there would paint the pre-edit content over an
 * edit that is still only in the store. Same reasoning as `effectiveSkip` in
 * `reconcileWithBackend` (sync.ts). The residual race is narrow and one-sided:
 * this tab's in-flight write wins that path, and the other view's change for
 * it is dropped from this store until the next reconcile re-reads it.
 *
 * A row that is gone, or staged for delete, is an eviction rather than a
 * merge — `mergeChangedIntoStore` takes those as `alsoAffected` keys, which is
 * exactly what a reconcile's `deleted` list is.
 */
async function foldCacheChange(vaultId: string, paths: Iterable<string>): Promise<void> {
  // Not registered here (never was, or removed in Settings): there is no layer
  // to write, and re-checked after the awaits below for the same reason
  // `reconcileWithBackend` re-checks before its own merge.
  if (!getBackend(vaultId)) return
  const inFlight = getInFlightPaths(vaultId)
  const records: Array<{ path: string; content: string }> = []
  const evicted: EntryKey[] = []
  for (const path of paths) {
    if (inFlight.has(path)) continue
    const row = await cacheGetRecord(vaultId, path)
    if (!row || row.status === 'deleted') { evicted.push(pathToKey(vaultId, path)); continue }
    records.push({ path, content: row.content })
  }
  if (records.length === 0 && evicted.length === 0) return
  const backend = getBackend(vaultId)
  if (!backend) return
  mergeChangedIntoStore(vaultId, records, evicted)
  // The other view's edit is dirty in the shared cache until someone pushes it,
  // so this view's sync chip is wrong until it re-counts.
  updateSyncUI(backend)
}

function flushCrossTab(): void {
  _crossTabTimer = null
  const batches = [..._pendingCrossTab]
  _pendingCrossTab.clear()
  for (const [vaultId, paths] of batches) {
    // Fire-and-forget, and never rejects onward: a fold that fails is a stale
    // view, not a lost write, and it must not become an unhandled rejection.
    void foldCacheChange(vaultId, paths).catch((e: unknown) => {
      console.error(`[vault] could not fold a cross-tab change for ${vaultId}:`, e)
    })
  }
}

/**
 * Start listening for other views' cache writes. Returns the unsubscribe.
 *
 * Called once for the app's lifetime (`routes/__root.tsx`), not per vault: the
 * announcement carries its own `vaultId`, and a vault that is not registered
 * here is dropped by `foldCacheChange` rather than by a subscription that would
 * have to be torn down and rebuilt on every registry change.
 */
export function startCrossTabSync(): () => void {
  const off = onCacheChange(({ vaultId, paths }) => {
    const bucket = _pendingCrossTab.get(vaultId) ?? new Set<string>()
    for (const p of paths) bucket.add(p)
    _pendingCrossTab.set(vaultId, bucket)
    _crossTabTimer ??= setTimeout(flushCrossTab, CROSS_TAB_COALESCE_MS)
  })
  return () => {
    off()
    if (_crossTabTimer) { clearTimeout(_crossTabTimer); _crossTabTimer = null }
    _pendingCrossTab.clear()
  }
}
