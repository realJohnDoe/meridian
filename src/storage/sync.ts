import {
  cacheWrite, cacheBulkWriteClean, cacheDelete, cacheGetDirty,
  cacheWriteClean, cacheDirtyCount, cacheLoadAll,
  cacheWriteTombstone, cacheGetTombstones,
} from '@/cache'
import type { CacheRecord } from '@/cache'
import { conflictPath } from './conflictName'
import { ConflictError } from './conflictError'
import type { StorageBackend } from './backend'
import { collapseToYaml } from '@/model/collapse'
import { parseToStoreItems } from '@/model/storeItems'
import { fileSlugItems } from '@/model/storeOps'
import { saveFile } from '@/fileIO'
import type { StoreItem, Roots } from '@/types'
import { getItems, getRoots, setData, notify, warn, setSyncDirtyCount, setSyncError } from '@/storeBridge'
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
  setSyncError(null)
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
): Promise<void> {
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
): { changed: string[]; deleted: string[] } {
  const cacheMap = new Map(cacheRecords.map(r => [r.path, r]))
  const changed: string[] = []
  const deleted: string[] = []

  for (const [path, diskToken] of diskTokens) {
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
    // Drop locally-cached files that vanished from the backend — but don't
    // clobber pending local changes (dirty) or pending deletes (tombstone).
    if (!diskTokens.has(entry.path) && entry.dirty === 0) deleted.push(entry.path)
  }

  return { changed, deleted }
}

export async function reconcileWithBackend(backend: StorageBackend, vaultId: string): Promise<void> {
  const diskTokens = await backend.statAll()
  const cached     = await cacheLoadAll(vaultId)
  const cacheMap   = new Map(cached.map(r => [r.path, r]))

  const { changed, deleted } = planReconcile(diskTokens, cached)

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

  const { items, roots } = parseFiles(Array.from(cacheMap.values()))
  setData({ items, roots })
  updateSyncUI()
}

// ── SYNC CORE ─────────────────────────────────────────────────────────

let _syncing = false
let _pushTimer: ReturnType<typeof setTimeout> | null = null

async function pushDirty(backend: StorageBackend, vaultId: string): Promise<boolean> {
  const dirty      = await cacheGetDirty(vaultId)
  const tombstones = await cacheGetTombstones(vaultId)
  if (!dirty.length && !tombstones.length) return false

  let hadCollision = false

  for (const f of dirty) {
    try {
      // CAS write: pass the base version as the precondition. The backend
      // throws ConflictError only when the content genuinely diverged — it
      // never false-positives due to stale listing tokens.
      const newVersion = await backend.write(f.path, f.content, f.version)
      await cacheWriteClean(vaultId, f.path, f.content, newVersion)
    } catch (e) {
      if (e instanceof ConflictError) {
        await resolveCollision(backend, vaultId, f.path, f.content)
        hadCollision = true
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
  }

  return hadCollision
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
    const hadCollision = await pushDirty(backend, vaultId)
    if (opts.pull || hadCollision) {
      await reconcileWithBackend(backend, vaultId)
    }
    setSyncError(null)
    updateSyncUI()
  } catch (e) {
    console.error('[vault] sync failed:', e)
    const msg = (e as Error).message || (e as Error).name || 'Unknown error'
    setSyncError(msg)
    notify('Sync failed: ' + msg)
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
  void runSync({ silent: true, pull: true })
}

export async function syncToBackend(): Promise<void> {
  await runSync({ silent: false, pull: true })
}

// ── CACHE WRITE / DELETE ──────────────────────────────────────

export async function writeEntityToCache(fileSlug: string): Promise<void> {
  try {
    const backend = getActiveBackend()
    if (!backend || backend.readOnly) return
    const slugItems = fileSlugItems(getItems(), fileSlug)
    if (slugItems.length === 0) { await deleteFromBackend(fileSlug); return }
    const root        = getRoots().get(fileSlug)
    const frontmatter = collapseToYaml(slugItems, root)
    const body        = root?.body ?? ''
    const content     = saveFile(frontmatter, body)
    const path        = fileSlugToPath(fileSlug)
    await cacheWrite(backend.id, path, content)
    updateSyncUI()
    scheduleAutoPush()
  } catch (e) {
    console.error('[vault] writeEntityToCache failed:', e)
    notify('Save failed: ' + ((e as Error).message || (e as Error).name))
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
    notify('Delete failed: ' + ((e as Error).message || (e as Error).name))
  }
}
