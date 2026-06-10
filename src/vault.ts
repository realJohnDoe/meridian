import {
  cacheWrite, cacheBulkWriteClean, cacheDelete, cacheGetDirty,
  cacheMarkClean, cacheDirtyCount, cacheLoadAll,
  dirHandleSave, dirHandleLoad, dirHandleClear,
  cacheInit,
} from './cache'
import { diskPickDirectory, diskStatAll, diskReadFiles, diskReadAll, diskWrite, diskDelete, saveFile } from './fileIO'
import { collapseToYaml } from './model/collapse'
import { parseToStoreItems } from './model/storeItems'
import { fileSlugItems } from './model/storeOps'
import type { StoreItem, Roots } from './types'
import { getItems, getRoots, setData, getDirHandle, setDirHandle, notify } from './storeBridge'
import { loadSeedItems } from './seed'

import { useStore } from './store'

// ── HELPERS ────────────────────────────────────────────────────

function fileSlugToPath(fileSlug: string): string {
  return fileSlug + '.md'
}

function updateSyncUI(): void {
  cacheDirtyCount().then(n => {
    useStore.setState({ syncDirtyCount: n })
  }).catch(() => {})
}

function parseFiles(
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

// ── CACHE WRITE / DELETE ──────────────────────────────────────

export async function writeEntityToCache(fileSlug: string): Promise<void> {
  try {
    const slugItems = fileSlugItems(getItems(), fileSlug)
    if (slugItems.length === 0) { await deleteFileFromDisk(fileSlug); return }
    const root        = getRoots().get(fileSlug)
    const frontmatter = collapseToYaml(slugItems, root)
    const body        = root?.body ?? ''
    const content     = saveFile(frontmatter, body)
    const path        = fileSlugToPath(fileSlug)
    // Use a synthetic version token so the next reconcile knows this file may differ from disk.
    await cacheWrite(path, content, `local:${Date.now()}`)
    updateSyncUI()
  } catch (e) {
    console.error('[vault] writeEntityToCache failed:', e)
  }
}

export async function deleteFileFromDisk(fileSlug: string): Promise<void> {
  try {
    const path = fileSlugToPath(fileSlug)
    const dh   = getDirHandle()
    await cacheDelete(path)
    if (dh) await diskDelete(dh, path)
    updateSyncUI()
  } catch (e) {
    console.error('[vault] deleteFileFromDisk failed:', e)
  }
}

// ── SYNC ──────────────────────────────────────────────────────

export async function syncToDirectory(): Promise<void> {
  try {
    const dh = getDirHandle()
    if (!dh) { notify('No vault folder connected. Click the folder icon first.'); return }
    const dirty = await cacheGetDirty()
    if (!dirty.length) { updateSyncUI(); return }
    for (const f of dirty) {
      await diskWrite(dh, f.path, f.content)
      await cacheMarkClean(f.path)
    }
    useStore.setState({ syncDirtyCount: 0, syncFlash: true })
    setTimeout(() => useStore.setState({ syncFlash: false }), 800)
  } catch (e) {
    console.error('[vault] sync failed:', e)
    notify('Sync failed: ' + ((e as Error).message || (e as Error).name))
  }
}

// ── HYDRATE FROM CACHE ────────────────────────────────────────

/** Paint instantly from last session's cached content (no disk IO). No-op if cache is empty. */
async function hydrateFromCache(): Promise<void> {
  const cached = await cacheLoadAll()
  if (cached.length === 0) return
  const { items, roots } = parseFiles(cached)
  setData({ items, roots })
}

// ── RECONCILE WITH DISK ───────────────────────────────────────

/**
 * Diff disk vs cache by version token, re-read only changed/new files,
 * drop deleted ones, then update the store atomically.
 */
async function reconcileWithDisk(): Promise<void> {
  const dh = getDirHandle()
  if (!dh) return

  // Stat disk (cheap — no file content read)
  const diskTokens = await diskStatAll(dh)

  // Build a map of current cache records
  const cached = await cacheLoadAll()
  const cacheMap = new Map(cached.map(r => [r.path, r]))

  const changed: string[] = []
  const deleted: string[] = []

  // Find new and changed files
  for (const [path, diskToken] of diskTokens) {
    const entry = cacheMap.get(path)
    if (!entry || entry.version !== diskToken) {
      changed.push(path)
    }
  }

  // Find deleted files (in cache but not on disk)
  for (const path of cacheMap.keys()) {
    if (!diskTokens.has(path)) {
      deleted.push(path)
    }
  }

  // Re-read only changed/new files
  if (changed.length > 0) {
    const freshFiles = await diskReadFiles(dh, changed)
    await cacheBulkWriteClean(freshFiles)
    // Update cacheMap with fresh records
    for (const f of freshFiles) {
      cacheMap.set(f.path, { path: f.path, content: f.content, dirty: 0, updatedAt: Date.now(), version: f.version })
    }
  }

  // Remove deleted files from cache
  await Promise.all(deleted.map(p => cacheDelete(p)))
  for (const p of deleted) cacheMap.delete(p)

  // If nothing changed, skip store update (avoids unnecessary re-renders)
  if (changed.length === 0 && deleted.length === 0) {
    updateSyncUI()
    return
  }

  const { items, roots } = parseFiles(Array.from(cacheMap.values()))
  setData({ items, roots })
  updateSyncUI()
}

// ── DIRECTORY LIFECYCLE ───────────────────────────────────────

let _pendingDirHandle: FileSystemDirectoryHandle | null = null

export async function pickDirectory(): Promise<void> {
  try {
    await cacheInit()
    const h = await diskPickDirectory()

    // Clear cache when switching folders — cache is path-keyed, not vault-namespaced,
    // so stale entries from a previous folder must not bleed into the new one.
    const previousHandle = await dirHandleLoad()
    if (previousHandle && typeof previousHandle.isSameEntry === 'function') {
      const same = await previousHandle.isSameEntry(h).catch(() => false)
      if (!same) {
        const cached = await cacheLoadAll()
        await Promise.all(cached.map(r => cacheDelete(r.path)))
      }
    } else if (previousHandle) {
      // isSameEntry not available — clear on every explicit pick to be safe
      const cached = await cacheLoadAll()
      await Promise.all(cached.map(r => cacheDelete(r.path)))
    }

    setDirHandle(h)
    await dirHandleSave(h)
    useStore.setState({ pendingDirReconnect: null })
    _pendingDirHandle = null

    // No prior cache for this folder; full read (cache is empty, everything is "new")
    const files = await diskReadAll(h)
    await cacheBulkWriteClean(files)
    const { items, roots } = parseFiles(files)
    setData({ items, roots })
    useStore.setState({ scrollToTodayOnce: true })
    updateSyncUI()
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    console.error('[vault] pickDirectory failed:', e)
    notify((e as Error).message || 'Could not connect vault')
  }
}

export async function tryRestoreDirectory(): Promise<void> {
  try {
    await cacheInit()
    const h = await dirHandleLoad()
    if (!h) { setData(loadSeedItems()); return }
    const perm = await h.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      setDirHandle(h)
      await hydrateFromCache()      // instant first paint from last session
      await reconcileWithDisk()     // catch any external edits
    } else if (perm === 'prompt') {
      _pendingDirHandle = h
      useStore.setState({ pendingDirReconnect: h.name })
      await hydrateFromCache()      // show cached data while reconnect banner is visible
    } else {
      await dirHandleClear()
      setData(loadSeedItems())
    }
  } catch (e) {
    console.warn('[vault] tryRestoreDirectory failed:', e)
    setData(loadSeedItems())
  }
}

export async function reconnectDirectory(): Promise<void> {
  if (!_pendingDirHandle) return
  try {
    const perm = await _pendingDirHandle.requestPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      setDirHandle(_pendingDirHandle)
      useStore.setState({ pendingDirReconnect: null })
      _pendingDirHandle = null
      await reconcileWithDisk()     // cache already hydrated in tryRestoreDirectory
      useStore.setState({ scrollToTodayOnce: true })
    } else {
      await dirHandleClear()
      useStore.setState({ pendingDirReconnect: null })
      _pendingDirHandle = null
    }
  } catch (e) {
    console.error('[vault] reconnectDirectory failed:', e)
    notify((e as Error).message || 'Could not reconnect vault')
  }
}

// ── INIT ──────────────────────────────────────────────────────

export function initApp(): void {
  // Items stay empty until tryRestoreDirectory() resolves.
}
