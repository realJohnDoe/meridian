import {
  cacheWrite, cacheBulkWriteClean, cacheDelete, cacheGetDirty,
  cacheWriteClean, cacheDirtyCount, cacheLoadAll, cacheInit, cacheDeleteAll,
  handleSave, handleLoad, handleClear,
  tokenSave, tokenLoad, tokenClear,
  vaultRefsSave, vaultRefsLoad,
  activeVaultIdSave, activeVaultIdLoad,
} from './cache'
import type { CacheRecord } from './cache'
import { conflictPath } from './storage/conflictName'
import { ConflictError } from './storage/conflictError'
import { diskPickDirectory } from './storage/fs'
import { LocalBackend }   from './storage/localBackend'
import { ExampleBackend } from './storage/exampleBackend'
import { GitHubBackend }  from './storage/githubBackend'
import type { StorageBackend, VaultRef, GitHubVaultRef } from './storage/backend'
import { collapseToYaml } from './model/collapse'
import { parseToStoreItems } from './model/storeItems'
import { fileSlugItems } from './model/storeOps'
import { saveFile } from './fileIO'
import type { StoreItem, Roots } from './types'
import { getItems, getRoots, setData, getVaults, notify, warn } from './storeBridge'
import { useStore } from './store'

// ── HELPERS ────────────────────────────────────────────

function fileSlugToPath(fileSlug: string): string {
  return fileSlug + '.md'
}

function updateSyncUI(): void {
  const id = _activeBackend?.id
  if (!id || _activeBackend?.readOnly) {
    useStore.setState({ syncDirtyCount: 0 })
    return
  }
  cacheDirtyCount(id).then(n => {
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

// ── COLLISION RESOLUTION ───────────────────────────────────────

/**
 * Handle a write collision: backend version of `path` has drifted while the
 * cache also has unsaved local edits.
 *
 * Resolution:
 *  1. Re-pull the backend's copy → overwrite the original path in cache (clean).
 *  2. Write the local content to a timestamped copy on the backend immediately.
 *  3. Cache the copy (clean) and notify the user.
 *
 * `cacheMap` is provided by reconcileWithDisk so it can update in-place before
 * the subsequent parseFiles call reflects both entries.
 */
async function resolveCollision(
  backend: StorageBackend,
  vaultId: string,
  path: string,
  localContent: string,
  cacheMap?: Map<string, CacheRecord>,
): Promise<void> {
  // Step 1: fetch the backend's current version of the original file.
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

  // Step 2: write the local content to the backend under a conflict-copy path.
  const copy = conflictPath(path, new Date())
  await backend.write(copy, localContent)

  // Step 3: determine the version of the newly written copy and cache it.
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

// ── MODULE STATE ───────────────────────────────────────────────

let _activeBackend: StorageBackend | null = null
let _syncing = false
let _pushTimer: ReturnType<typeof setTimeout> | null = null

// ── PRIVATE ACTIVATION HELPERS ─────────────────────────────────

async function hydrateFromCache(vaultId: string): Promise<void> {
  const cached = await cacheLoadAll(vaultId)
  if (cached.length === 0) return
  const { items, roots } = parseFiles(cached)
  setData({ items, roots })
}

async function reconcileWithDisk(backend: StorageBackend, vaultId: string): Promise<void> {
  const diskTokens = await backend.statAll()
  const cached     = await cacheLoadAll(vaultId)
  const cacheMap   = new Map(cached.map(r => [r.path, r]))

  const changed: string[] = []
  const deleted: string[] = []

  for (const [path, diskToken] of diskTokens) {
    const entry = cacheMap.get(path)
    // Skip dirty entries — any genuine divergence will be caught by the CAS
    // write in pushDirty. Don't over-pull based on an eventually-consistent
    // listing token that might be stale.
    if ((!entry || entry.version !== diskToken) && entry?.dirty !== 1) {
      changed.push(path)
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

  await Promise.all(deleted.map(p => cacheDelete(vaultId, p)))
  for (const p of deleted) cacheMap.delete(p)

  if (changed.length === 0 && deleted.length === 0) { updateSyncUI(); return }

  const { items, roots } = parseFiles(Array.from(cacheMap.values()))
  setData({ items, roots })
  updateSyncUI()
}

async function activateExampleVault(): Promise<void> {
  const backend = new ExampleBackend()
  _activeBackend = backend
  useStore.setState({ activeVaultId: 'example', pendingDirReconnect: null, scrollToTodayOnce: true })
  await activeVaultIdSave('example')
  const files = await backend.readAll()
  setData(parseFiles(files))
  updateSyncUI()
}

async function activateWritableVault(backend: StorageBackend): Promise<void> {
  _activeBackend = backend
  useStore.setState({ activeVaultId: backend.id, pendingDirReconnect: null, scrollToTodayOnce: true })
  await activeVaultIdSave(backend.id)
  await hydrateFromCache(backend.id)
  await reconcileWithDisk(backend, backend.id)
}

// ── CACHE WRITE / DELETE ──────────────────────────────────────

export async function writeEntityToCache(fileSlug: string): Promise<void> {
  try {
    if (!_activeBackend || _activeBackend.readOnly) return
    const slugItems = fileSlugItems(getItems(), fileSlug)
    if (slugItems.length === 0) { await deleteFileFromDisk(fileSlug); return }
    const root        = getRoots().get(fileSlug)
    const frontmatter = collapseToYaml(slugItems, root)
    const body        = root?.body ?? ''
    const content     = saveFile(frontmatter, body)
    const path        = fileSlugToPath(fileSlug)
    await cacheWrite(_activeBackend.id, path, content)
    updateSyncUI()
    scheduleAutoPush()
  } catch (e) {
    console.error('[vault] writeEntityToCache failed:', e)
    notify('Save failed: ' + ((e as Error).message || (e as Error).name))
  }
}

export async function deleteFileFromDisk(fileSlug: string): Promise<void> {
  try {
    if (!_activeBackend || _activeBackend.readOnly) return
    const path = fileSlugToPath(fileSlug)
    await cacheDelete(_activeBackend.id, path)
    await _activeBackend.delete(path)
    updateSyncUI()
  } catch (e) {
    console.error('[vault] deleteFileFromDisk failed:', e)
    notify('Delete failed: ' + ((e as Error).message || (e as Error).name))
  }
}

// ── SYNC CORE ─────────────────────────────────────────────────

/** Pushes all dirty cache entries to the backend. Returns true if any collision occurred. */
async function pushDirty(backend: StorageBackend, vaultId: string): Promise<boolean> {
  const dirty = await cacheGetDirty(vaultId)
  if (!dirty.length) return false

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

  return hadCollision
}

async function runSync(opts: { silent: boolean; pull: boolean }): Promise<void> {
  if (!_activeBackend || _activeBackend.readOnly) {
    if (!opts.silent) notify('No writable vault connected. Add a local folder first.')
    return
  }
  if (_syncing) return
  _syncing = true

  const backend = _activeBackend
  const vaultId = backend.id

  try {
    const hadCollision = await pushDirty(backend, vaultId)
    if (opts.pull || hadCollision) {
      await reconcileWithDisk(backend, vaultId)
    }
    useStore.setState({ syncError: false, syncFlash: true })
    setTimeout(() => useStore.setState({ syncFlash: false }), 800)
    updateSyncUI()
  } catch (e) {
    console.error('[vault] sync failed:', e)
    useStore.setState({ syncError: true })
    if (!opts.silent) notify('Sync failed: ' + ((e as Error).message || (e as Error).name))
  } finally {
    _syncing = false
  }
}

export function scheduleAutoPush(): void {
  if (!_activeBackend || _activeBackend.readOnly) return
  if (_pushTimer) clearTimeout(_pushTimer)
  _pushTimer = setTimeout(() => { _pushTimer = null; void runSync({ silent: true, pull: false }) }, 1000)
}

export function autoSyncTick(): void {
  void runSync({ silent: true, pull: true })
}

export async function syncToDirectory(): Promise<void> {
  await runSync({ silent: false, pull: true })
}

// ── VAULT LIFECYCLE ───────────────────────────────────────────

export async function restoreVaults(): Promise<void> {
  const exampleRef: VaultRef = { id: 'example', name: 'Example data', kind: 'example' }

  async function fallbackToExample() {
    const backend = new ExampleBackend()
    _activeBackend = backend
    useStore.setState({
      vaults: [exampleRef],
      activeVaultId: 'example',
      pendingDirReconnect: null,
    })
    setData(parseFiles(await backend.readAll()))
  }

  try {
    await cacheInit()

    // ── Load registry ─────────────────────────────────────────────
    const savedRefs = await vaultRefsLoad()
    const allRefs: VaultRef[] = [exampleRef, ...savedRefs]
    useStore.setState({ vaults: allRefs })

    // ── Determine active vault ────────────────────────────────────
    const savedActiveId = await activeVaultIdLoad()
    const targetRef     = allRefs.find(r => r.id === savedActiveId) ?? exampleRef

    if (targetRef.kind === 'local') {
      const handle = await handleLoad(targetRef.id)
      if (!handle) { await activateExampleVault(); return }
      const backend = new LocalBackend(targetRef.id, targetRef.name, handle)
      const perm    = await backend.ensurePermission(false)
      if (perm === 'granted') {
        await activateWritableVault(backend)
      } else if (perm === 'prompt') {
        // Show cached data; user reconnects by clicking the vault in the sidebar.
        _activeBackend = backend
        useStore.setState({ activeVaultId: targetRef.id, pendingDirReconnect: targetRef.name })
        await hydrateFromCache(targetRef.id)
        updateSyncUI()
      } else {
        await activateExampleVault()
      }
    } else if (targetRef.kind === 'github') {
      const token = await tokenLoad(targetRef.id)
      if (!token) { await activateExampleVault(); return }
      const backend = new GitHubBackend(targetRef.id, targetRef.name, { ...targetRef.github, token })
      const perm    = await backend.ensurePermission(false)
      if (perm === 'granted') {
        await activateWritableVault(backend)
      } else {
        notify(`Could not reconnect GitHub vault "${targetRef.name}" — check your token.`)
        await activateExampleVault()
      }
    } else {
      await activateExampleVault()
    }
  } catch (e) {
    console.warn('[vault] restoreVaults failed:', e)
    await fallbackToExample().catch(() => {})
  }
}

export async function setActiveVault(id: string): Promise<void> {
  try {
    if (id === 'example') { await activateExampleVault(); return }

    const ref = getVaults().find(v => v.id === id)
    if (!ref) return

    if (ref.kind === 'local') {
      const handle = await handleLoad(id)
      if (!handle) { notify('Vault handle not found — try removing and re-adding it.'); return }

      const backend = new LocalBackend(id, ref.name, handle)
      const perm    = await backend.ensurePermission(true)
      if (perm !== 'granted') { notify(`Permission denied for vault "${ref.name}".`); return }

      await activateWritableVault(backend)
    } else if (ref.kind === 'github') {
      const token = await tokenLoad(id)
      if (!token) { notify('GitHub token not found — try removing and re-adding this vault.'); return }

      const backend = new GitHubBackend(id, ref.name, { ...ref.github, token })
      const perm    = await backend.ensurePermission(true)
      if (perm !== 'granted') { notify(`Could not connect to GitHub vault "${ref.name}" — check your token.`); return }

      await activateWritableVault(backend)
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    console.error('[vault] setActiveVault failed:', e)
    notify((e as Error).message || 'Could not switch vault')
  }
}

export async function addLocalVault(): Promise<void> {
  try {
    await cacheInit()
    const handle = await diskPickDirectory()
    const id     = crypto.randomUUID()

    await handleSave(id, handle)

    const ref: VaultRef   = { id, name: handle.name, kind: 'local' }
    const existing        = await vaultRefsLoad()
    await vaultRefsSave([...existing, ref])

    const exampleRef: VaultRef = { id: 'example', name: 'Example data', kind: 'example' }
    useStore.setState({ vaults: [exampleRef, ...existing, ref] })

    const backend = new LocalBackend(id, handle.name, handle)
    const files   = await backend.readAll()
    await cacheBulkWriteClean(id, files)
    await activateWritableVault(backend)
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    console.error('[vault] addLocalVault failed:', e)
    notify((e as Error).message || 'Could not connect vault')
  }
}

export interface GitHubVaultConfig {
  owner:  string
  repo:   string
  branch: string
  token:  string
}

export async function addGitHubVault(cfg: GitHubVaultConfig): Promise<void> {
  try {
    await cacheInit()
    const id = crypto.randomUUID()

    // Validate token + repo access before saving anything
    const backend = new GitHubBackend(id, `${cfg.owner}/${cfg.repo}`, cfg)
    const perm    = await backend.ensurePermission(true)
    if (perm !== 'granted') {
      notify('Could not connect to GitHub repository — check your token and repo name.')
      return
    }

    await tokenSave(id, cfg.token)

    const ref: GitHubVaultRef = {
      id,
      name:   `${cfg.owner}/${cfg.repo}`,
      kind:   'github',
      github: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch },
    }
    const existing = await vaultRefsLoad()
    await vaultRefsSave([...existing, ref])

    const exampleRef: VaultRef = { id: 'example', name: 'Example data', kind: 'example' }
    useStore.setState({ vaults: [exampleRef, ...existing, ref] })

    const files = await backend.readAll()
    await cacheBulkWriteClean(id, files)
    await activateWritableVault(backend)
  } catch (e) {
    console.error('[vault] addGitHubVault failed:', e)
    notify((e as Error).message || 'Could not connect GitHub vault')
  }
}

// ── REMOVE VAULT ─────────────────────────────────────────────

export async function removeVault(id: string): Promise<void> {
  try {
    const existing = await vaultRefsLoad()
    const ref      = existing.find(r => r.id === id)
    if (!ref) return

    // Clean up kind-specific secrets / handles
    if (ref.kind === 'local')  await handleClear(id)
    if (ref.kind === 'github') await tokenClear(id)

    // Delete all cached files for this vault
    await cacheDeleteAll(id)

    // Remove from registry and update store
    const updated = existing.filter(r => r.id !== id)
    await vaultRefsSave(updated)
    const exampleRef = { id: 'example', name: 'Example data', kind: 'example' as const }
    useStore.setState({ vaults: [exampleRef, ...updated] })

    // If this was the active vault, fall back to example
    if (_activeBackend?.id === id) {
      await activateExampleVault()
    }
  } catch (e) {
    console.error('[vault] removeVault failed:', e)
    notify((e as Error).message || 'Could not remove vault')
  }
}

// ── INIT ──────────────────────────────────────────────────────

export function initApp(): void {
  // Items stay empty until restoreVaults() resolves.
}
