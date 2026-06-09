import {
  cacheWrite, cacheWriteClean, cacheDelete, cacheGetDirty,
  cacheMarkClean, cacheDirtyCount,
  dirHandleSave, dirHandleLoad, dirHandleClear,
  cacheInit,
} from './cache'
import { diskPickDirectory, diskReadAll, diskWrite, diskDelete, saveFile } from './fileIO'
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
    await cacheWrite(path, content)
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

// ── LOAD ──────────────────────────────────────────────────────

async function loadFilesFromDisk(): Promise<void> {
  const dh = getDirHandle()
  if (!dh) return
  const files = await diskReadAll(dh)
  const loaded: StoreItem[] = []
  const roots: Roots = new Map()
  for (const { path, content } of files) {
    await cacheWriteClean(path, content)
    try {
      const parsed = parseToStoreItems(path, content)
      loaded.push(...parsed.items)
      const slug = path.replace(/\.(md|yaml|yml)$/, '')
      roots.set(slug, parsed.root)
    } catch (e) { console.warn('[vault] parse failed for', path, e) }
  }
  setData({ items: loaded, roots })
  updateSyncUI()
}

// ── DIRECTORY LIFECYCLE ───────────────────────────────────────

let _pendingDirHandle: FileSystemDirectoryHandle | null = null

export async function pickDirectory(): Promise<void> {
  try {
    await cacheInit()
    const h = await diskPickDirectory()
    setDirHandle(h)
    await dirHandleSave(h)
    useStore.setState({ pendingDirReconnect: null })
    _pendingDirHandle = null
    await loadFilesFromDisk()
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
      await loadFilesFromDisk()
    } else if (perm === 'prompt') {
      _pendingDirHandle = h
      useStore.setState({ pendingDirReconnect: h.name })
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
      await loadFilesFromDisk()
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
