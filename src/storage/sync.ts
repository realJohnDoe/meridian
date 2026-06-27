import {
  cacheWrite, cacheBulkWriteClean, cacheDelete, cacheGetDirty,
  cacheWriteClean, cacheDirtyCount, cacheLoadAll,
  cacheWriteTombstone, cacheGetTombstones,
} from '@/storage/cache'
import type { CacheRecord } from '@/storage/cache'
import { conflictPath } from './conflictName'
import { ConflictError, isTransientSyncError } from './conflictError'
import type { StorageBackend } from './backend'
import { collapseToYaml, parseToStoreItems, fileSlugItems } from '@/model'
import { saveFile } from '@/fileIO'
import type { StoreItem, Roots } from '@/types'
import {
  getItems, getRoots, setData,
  setSyncDirtyCount, setSyncError, setSyncOffline, setLastSyncedAt,
} from '@/storeBridge'
import { notify, warn, notifyError } from '@/notifications'
import { getActiveBackend } from './activeBackend'

// ── HELPERS ────────────────────────────────────────────────────

function fileSlugToPath(fileSlug: string): string {
  return fileSlug + '.md'
}

export function updateSyncUI(): void {
  const backend = getActiveBackend()
  if (!backend?.id || backend.readOnly) {
    setSyncDirtyCount(0)
    setSyncError('Read-only vault')
    return
  }
  cacheDirtyCount(backend.id).then(n => setSyncDirtyCount(n)).catch(() => {})
}

export function parseFiles(
  files: Array<{ path: string; content: string }>,
): { items: StoreItem[]; roots: Roots } {
  const loaded: StoreItem[] = []
  const roots: Roots = new Map()
  for (const { path, content } of files) {
    try {
      const parsed = parseToStoreItems(path, content)
      loaded.push(...parsed.items)
      roots.set(path.replace(/\.(md|yaml|yml)$/, ''), parsed.root)
    } catch (e) { console.warn('[vault] parse failed for', path, e) }
  }
  return { items: loaded, roots }
}

// ── COLLISION RESOLUTION ───────────────────────────────────────────

/**
 * Handle a write collision: backend version of `path` has drifted while the
 * cache also has unsaved local edits.
 *
 * Resolution:
 *  1. Re-pull the backend's copy → overwrite the original path in cache (clean).
 *  2. Write the local content to a timestamped copy on the backend immediately.
 *  3. Cache the copy (clean) and notify the user.
 */
async function resolveCollision(
  backend: StorageBackend,
  vaultId: string,
  path: string,
  localContent: string,
  cacheMap?: Map<string, CacheRecord>,
): Promise<string> {
  const [fresh] = await backend.readFiles([path])
  if (fresh) {
    await cacheWriteClean(vaultId, path, fresh.content, fresh.version)
    if (cacheMap) {
      cacheMap.set(path, {
        vaultPath: `${vaultId}::${path}`,
        vaultId, path,
        content: fresh.content,
        dirty: 0,
        updatedAt: Date.now(),
        version: fresh.version,
      })
    }
  }

  const copy = conflictPath(path, new Date())
  await backend.write(copy, localContent)

  let copyVersion: string | undefined
  const [copyFresh] = await backend.readFiles([copy])
  if (copyFresh) copyVersion = copyFresh.version

  await cacheWriteClean(vaultId, copy, localContent, copyVersion)
  if (cacheMap && copyVersion !== undefined) {
    cacheMap.set(copy, {
      vaultPath: `${vaultId}::${copy}`,
      vaultId, path: copy,
      content: localContent,
      dirty: 0,
      updatedAt: Date.now(),
      version: copyVersion,
    })
  }

  warn(`Conflict on ${path} — your version saved as ${copy}.`)
  return copy
}

// ── RECONCILE ─────────────────────────────────────────────────

/**
 * Pure reconciliation planner: given the backend's listing tokens and the local
 * cache records, decide which paths to pull (`changed`) and which to drop
 * (`deleted`). Extracted as a side-effect-free function so the branching logic
 * can be unit-tested without Dexie, a backend, or the store.
 */
export function planReconcile(
  diskTokens: Map<string, string>,
  cacheRecords: CacheRecord[],
  skipPaths: Set<string> = new Set(),
): { changed: string[]; deleted: string[] } {
  const cacheMap = new Map(cacheRecords.map(r => [r.path, r]))
  const changed: string[] = []
  const deleted: string[] = []

  for (const [path, diskToken] of diskTokens) {
    // Skip paths we authoritatively wrote/deleted in this same sync cycle: we
    // already hold their true state, and GitHub's listing API is eventually
    // consistent, so it may still report the pre-push SHA (or omit a just-created
    // file). Trusting it here would re-pull stale content over our fresh write.
    if (skipPaths.has(path)) continue
    const entry = cacheMap.get(path)
    // Pull a file the cache has never seen, OR one whose backend version drifted
    // while we hold no pending local change. Skip dirty entries (pending write)
    // and tombstones (pending delete) — any genuine divergence on those is caught
    // by the CAS write in pushDirty.
    if (!entry || (entry.version !== diskToken && entry.dirty === 0)) {
      changed.push(path)
    }
  }
  for (const entry of cacheRecords) {
    if (skipPaths.has(entry.path)) continue
    // Drop locally-cached files that vanished from the backend — but don't
    // clobber pending local changes (dirty) or pending deletes (tombstone).
    if (!diskTokens.has(entry.path) && entry.dirty === 0) deleted.push(entry.path)
  }

  return { changed, deleted }
}

export async function reconcileWithBackend(
  backend: StorageBackend,
  vaultId: string,
  skipPaths: Set<string> = new Set(),
): Promise<void> {
  const diskTokens = await backend.statAll()
  const cached     = await cacheLoadAll(vaultId)
  const cacheMap   = new Map(cached.map(r => [r.path, r]))

  const { changed, deleted } = planReconcile(diskTokens, cached, skipPaths)

  if (changed.length > 0) {
    const freshFiles = await backend.readFiles(changed)
    await cacheBulkWriteClean(vaultId, freshFiles)
    for (const f of freshFiles) {
      cacheMap.set(f.path, { vaultPath: `${vaultId}::${f.path}`, vaultId, path: f.path, content: f.content, dirty: 0, updatedAt: Date.now(), version: f.version })
    }
  }

  await Promise.all(deleted.map(p => cacheDelete(vaultId, p)))
  for (const p of deleted) cacheMap.delete(p)

  if (changed.length === 0 && deleted.length === 0) { updateSyncUI(); return }

  // Collect slugs that were changed or deleted so we can evict them from the store.
  const affectedSlugs = new Set<string>()
  for (const p of changed) affectedSlugs.add(p.replace(/\.(md|yaml|yml)$/, ''))
  for (const p of deleted) affectedSlugs.add(p.replace(/\.(md|yaml|yml)$/, ''))

  // Keep items/roots that belong to untouched files.
  const keptItems = getItems().filter(item => !affectedSlugs.has(item.fileSlug))
  const keptRoots: Roots = new Map(
    [...getRoots()].filter(([slug]) => !affectedSlugs.has(slug)),
  )

  // Parse only the changed files and merge into the kept state.
  const changedRecords = changed
    .map(p => cacheMap.get(p))
    .filter((r): r is NonNullable<typeof r> => r != null)
  const { items: newItems, roots: newRoots } = parseFiles(changedRecords)

  setData({ items: [...keptItems, ...newItems], roots: new Map([...keptRoots, ...newRoots]) })
  updateSyncUI()
}

// ── SYNC CORE ─────────────────────────────────────────────────────────

let _syncing = false
let _pushTimer: ReturnType<typeof setTimeout> | null = null

// ── BACKOFF STATE ─────────────────────────────────────────────────────
const BACKOFF_BASE_MS  = 60_000
const BACKOFF_MAX_MS   = 30 * 60_000

let _consecutiveFailures = 0
let _nextRetryAt         = 0
// Dedupe toasts for actionable (non-transient) errors across silent ticks.
let _lastErrorSig: string | null = null

export function resetSyncBackoff(): void {
  _consecutiveFailures = 0
  _nextRetryAt         = 0
}

/**
 * Push pending local changes to the backend. Returns whether a collision
 * occurred and the set of paths we authoritatively wrote/deleted this cycle —
 * the latter must be skipped by a same-cycle reconcile (see planReconcile),
 * since the backend's listing API is eventually consistent and may not yet
 * reflect these writes.
 */
async function pushDirty(
  backend: StorageBackend,
  vaultId: string,
): Promise<{ hadCollision: boolean; pushed: Set<string> }> {
  const dirty      = await cacheGetDirty(vaultId)
  const tombstones = await cacheGetTombstones(vaultId)
  const pushed     = new Set<string>()
  if (!dirty.length && !tombstones.length) return { hadCollision: false, pushed }

  let hadCollision = false

  for (const f of dirty) {
    try {
      // CAS write: pass the base version as the precondition. The backend
      // throws ConflictError only when the content genuinely diverged — it
      // never false-positives due to stale listing tokens.
      const newVersion = await backend.write(f.path, f.content, f.version)
      await cacheWriteClean(vaultId, f.path, f.content, newVersion)
      pushed.add(f.path)
    } catch (e) {
      if (e instanceof ConflictError) {
        const copy = await resolveCollision(backend, vaultId, f.path, f.content)
        hadCollision = true
        pushed.add(f.path)
        pushed.add(copy)
      } else {
        throw e
      }
    }
  }

  for (const f of tombstones) {
    // Pass the cached version (blob SHA for GitHub) so the delete works even
    // when the backend's in-memory SHA cache is cold after a page reload.
    await backend.delete(f.path, f.version)
    await cacheDelete(vaultId, f.path)
    pushed.add(f.path)
  }

  return { hadCollision, pushed }
}

async function runSync(opts: { silent: boolean; pull: boolean }): Promise<void> {
  const backend = getActiveBackend()
  if (!backend || backend.readOnly) {
    if (!opts.silent) notify('No writable vault connected. Add a local folder first.')
    return
  }
  if (_syncing) return
  _syncing = true

  const vaultId = backend.id

  try {
    const { hadCollision, pushed } = await pushDirty(backend, vaultId)
    if (opts.pull || hadCollision) {
      await reconcileWithBackend(backend, vaultId, pushed)
    }
    // ── SUCCESS ──────────────────────────────────────────────────
    setSyncError(null)
    setSyncOffline(false)
    setLastSyncedAt(Date.now())
    _consecutiveFailures = 0
    _nextRetryAt         = 0
    _lastErrorSig        = null
    updateSyncUI()
  } catch (e) {
    console.error('[vault] sync failed:', e)

    if (isTransientSyncError(e)) {
      // ── TRANSIENT (offline / network drop) ───────────────────
      setSyncOffline(true)
      _consecutiveFailures++
      _nextRetryAt = Date.now() + Math.min(
        BACKOFF_BASE_MS * Math.pow(2, _consecutiveFailures - 1),
        BACKOFF_MAX_MS,
      )
      if (!opts.silent) {
        notify("You're offline — changes are saved locally and will sync when you reconnect.")
      }
    } else {
      // ── ACTIONABLE (auth, repo missing, etc.) ────────────────
      const msg = (e as Error).message || (e as Error).name || 'Unknown error'
      setSyncError(msg)
      if (!opts.silent || _lastErrorSig !== msg) {
        notifyError('Sync failed', e)
        _lastErrorSig = msg
      }
    }
  } finally {
    _syncing = false
  }
}

export function scheduleAutoPush(): void {
  const backend = getActiveBackend()
  if (!backend || backend.readOnly) return
  if (_pushTimer) clearTimeout(_pushTimer)
  _pushTimer = setTimeout(() => { _pushTimer = null; void runSync({ silent: true, pull: false }) }, 1000)
}

export function autoSyncTick(): void {
  if (Date.now() < _nextRetryAt) return
  void runSync({ silent: true, pull: true })
}

export async function syncToBackend(): Promise<void> {
  // Manual sync always bypasses the backoff gate.
  _nextRetryAt = 0
  await runSync({ silent: false, pull: true })
}

// ── CACHE WRITE / DELETE ──────────────────────────────────────

export async function writeEntityToCache(fileSlug: string): Promise<void> {
  try {
    const backend = getActiveBackend()
    if (!backend || backend.readOnly) return
    const t0 = performance.now()
    const slugItems = fileSlugItems(getItems(), fileSlug)
    if (slugItems.length === 0) { await deleteFromBackend(fileSlug); return }
    const root        = getRoots().get(fileSlug)
    const frontmatter = collapseToYaml(slugItems, root)
    const body        = root?.body ?? ''
    const content     = saveFile(frontmatter, body)
    const tCollapse = performance.now()
    console.log(`[perf:cache] collapse+serialize(${fileSlug}): ${(tCollapse - t0).toFixed(2)}ms`)
    const path        = fileSlugToPath(fileSlug)
    await cacheWrite(backend.id, path, content)
    console.log(`[perf:cache] cacheWrite(${fileSlug}): ${(performance.now() - tCollapse).toFixed(2)}ms`)
    updateSyncUI()
    scheduleAutoPush()
  } catch (e) {
    console.error('[vault] writeEntityToCache failed:', e)
    notifyError('Save failed', e)
  }
}

export async function deleteFromBackend(fileSlug: string): Promise<void> {
  try {
    const backend = getActiveBackend()
    if (!backend || backend.readOnly) return
    const path = fileSlugToPath(fileSlug)
    await cacheWriteTombstone(backend.id, path)
    updateSyncUI()
    scheduleAutoPush()
  } catch (e) {
    console.error('[vault] deleteFromBackend failed:', e)
    notifyError('Delete failed', e)
  }
}
