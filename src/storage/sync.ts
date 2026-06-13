import {
  cacheWrite, cacheBulkWriteClean, cacheDelete, cacheGetDirty,
  cacheMarkClean, cacheWriteClean, cacheDirtyCount, cacheLoadAll,
} from '../cache'
import type { CacheRecord } from '../cache'
import { conflictPath } from './conflictName'
import type { StorageBackend } from './backend'
import { collapseToYaml } from '../model/collapse'
import { parseToStoreItems } from '../model/storeItems'
import { fileSlugItems } from '../model/storeOps'
import { saveFile } from '../fileIO'
import type { StoreItem, Roots } from '../types'
import { getItems, getRoots, setData, notify, warn, setSyncDirtyCount, setSyncError } from '../storeBridge'
import { getActiveBackend } from './activeBackend'
import { emit } from '../events'

// ── HELPERS ────────────────────────────────────────────────────

function fileSlugToPath(fileSlug: string): string {
  return fileSlug + '.md'
}

export function updateSyncUI(): void {
  const backend = getActiveBackend()
  if (!backend?.id || backend.readOnly) {
    setSyncDirtyCount(0)
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

export async function reconcileWithBackend(backend: StorageBackend, vaultId: string): Promise<void> {
  const diskTokens = await backend.statAll()
  const cached     = await cacheLoadAll(vaultId)
  const cacheMap   = new Map(cached.map(r => [r.path, r]))

  const changed: string[] = []
  const collisions: Array<{ path: string; localContent: string }> = []
  const deleted: string[] = []

  for (const [path, diskToken] of diskTokens) {
    const entry = cacheMap.get(path)
    if (!entry || entry.version !== diskToken) {
      if (entry?.dirty === 1) {
        collisions.push({ path, localContent: entry.content })
      } else {
        changed.push(path)
      }
    }
  }
  for (const path of cacheMap.keys()) {
    const entry = cacheMap.get(path)
    if (!diskTokens.has(path) && entry?.dirty !== 1) deleted.push(path)
  }

  if (changed.length > 0) {
    const freshFiles = await backend.readFiles(changed)
    await cacheBulkWriteClean(vaultId, freshFiles)
    for (const f of freshFiles) {
      cacheMap.set(f.path, { vaultPath: `${vaultId}::${f.path}`, vaultId, path: f.path, content: f.content, dirty: 0, updatedAt: Date.now(), version: f.version })
    }
  }

  for (const { path, localContent } of collisions) {
    await resolveCollision(backend, vaultId, path, localContent, cacheMap)
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
  const dirty = await cacheGetDirty(vaultId)
  if (!dirty.length) return false

  const tokens = await backend.statAll()
  let hadCollision = false

  for (const f of dirty) {
    const cur     = tokens.get(f.path)
    const drifted = cur !== undefined && cur !== f.version
    if (drifted) {
      await resolveCollision(backend, vaultId, f.path, f.content)
      hadCollision = true
    } else {
      const newVersion = await backend.write(f.path, f.content)
      // Record the backend's new version as the base so the next edit isn't
      // mistaken for drift. Falls back to marking clean if unknown.
      if (newVersion !== undefined) await cacheWriteClean(vaultId, f.path, f.content, newVersion)
      else await cacheMarkClean(vaultId, f.path)
    }
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
    setSyncError(false)
    emit('sync:done')
    updateSyncUI()
  } catch (e) {
    console.error('[vault] sync failed:', e)
    setSyncError(true)
    if (!opts.silent) notify('Sync failed: ' + ((e as Error).message || (e as Error).name))
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
    await cacheDelete(backend.id, path)
    await backend.delete(path)
    updateSyncUI()
  } catch (e) {
    console.error('[vault] deleteFromBackend failed:', e)
    notify('Delete failed: ' + ((e as Error).message || (e as Error).name))
  }
}
