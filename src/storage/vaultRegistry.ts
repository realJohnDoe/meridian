import {
  cacheInit, cacheLoadAll, cacheBulkWriteClean, cacheDeleteAll,
  handleSave, handleLoad, handleClear,
  tokenSave, tokenClear,
  refreshTokenSave, refreshTokenClear,
  tokenExpirySave, tokenExpiryClear,
  vaultRefsSave, vaultRefsLoad,
  activeVaultIdSave, activeVaultIdLoad,
} from '@/storage/cache'
import { diskPickDirectory } from './fs'
import { LocalBackend }   from './localBackend'
import { ExampleBackend } from './exampleBackend'
import { GitHubBackend }  from './githubBackend'
import { ensureFreshAccessToken } from './githubOAuth'
import type { StorageBackend } from './backend'
import type { VaultRef, GitHubVaultRef } from '@/types'
import { setData, getVaults, setVaultList, setActiveVaultId, setPendingReconnect, setVaultLoading, setVaultLoadProgress } from '@/storeBridge'
import { notify, notifyError } from './notifications'
import { getActiveBackend, setActiveBackend } from './activeBackend'
import { reconcileWithBackend, parseFiles, updateSyncUI } from './sync'
// ── VAULT-CHANGE NOTIFICATION ──────────────────────────────────

const _vaultChangedListeners = new Set<() => void>()

export function onVaultChanged(fn: () => void): () => void {
  _vaultChangedListeners.add(fn)
  return () => _vaultChangedListeners.delete(fn)
}

function emitVaultChanged(): void {
  _vaultChangedListeners.forEach(fn => fn())
}

// ── CONSTANTS ─────────────────────────────────────────────────

const EXAMPLE_REF: VaultRef = { id: 'example', name: 'Tutorial', kind: 'example' }

// ── REGISTRY HELPER ───────────────────────────────────────────

async function updateVaultRefs(mutate: (current: VaultRef[]) => VaultRef[]): Promise<void> {
  const current = await vaultRefsLoad()
  const updated = mutate(current)
  await vaultRefsSave(updated)
  setVaultList([EXAMPLE_REF, ...updated])
}

// ── ACTIVATION HELPERS ─────────────────────────────────────────

async function hydrateFromCache(vaultId: string): Promise<void> {
  const cached = await cacheLoadAll(vaultId)
  if (cached.length === 0) return
  const { items, roots } = parseFiles(cached)
  setData({ items, roots })
}

async function activateExampleVault(): Promise<void> {
  const backend = new ExampleBackend()
  setActiveBackend(backend)
  setActiveVaultId('example')
  setPendingReconnect(null)
  await activeVaultIdSave('example')
  const files = await backend.readAll()
  setData(parseFiles(files))
  updateSyncUI()
  emitVaultChanged()
}

async function activateWritableVault(backend: StorageBackend): Promise<void> {
  setActiveBackend(backend)
  setActiveVaultId(backend.id)
  setPendingReconnect(null)
  await activeVaultIdSave(backend.id)
  await hydrateFromCache(backend.id)
  await reconcileWithBackend(backend, backend.id)
  emitVaultChanged()
}

async function registerAndActivate(ref: VaultRef, backend: StorageBackend): Promise<void> {
  await updateVaultRefs(existing => [...existing, ref])
  try {
    const files = await backend.readAll((loaded, total) => setVaultLoadProgress({ loaded, total }))
    await cacheBulkWriteClean(backend.id, files)
    await activateWritableVault(backend)
  } finally {
    // Reset even on a thrown/failed load, so a retry (or the next vault) never
    // inherits a stale "N of M" from an aborted first connect.
    setVaultLoadProgress(null)
  }
}

// ── VAULT LIFECYCLE ───────────────────────────────────────────

export async function restoreVaults(): Promise<void> {
  try {
    await restoreVaultsInner()
  } finally {
    setVaultLoading(false)
  }
}

async function restoreVaultsInner(): Promise<void> {
  async function fallbackToExample() {
    const backend = new ExampleBackend()
    setActiveBackend(backend)
    setVaultList([EXAMPLE_REF])
    setActiveVaultId('example')
    setPendingReconnect(null)
    setData(parseFiles(await backend.readAll()))
  }

  try {
    await cacheInit()

    const savedRefs = await vaultRefsLoad()
    const allRefs: VaultRef[] = [EXAMPLE_REF, ...savedRefs]
    setVaultList(allRefs)

    const savedActiveId = await activeVaultIdLoad()
    const targetRef     = allRefs.find(r => r.id === savedActiveId) ?? EXAMPLE_REF

    if (targetRef.kind === 'local') {
      const handle = await handleLoad(targetRef.id)
      if (!handle) { await activateExampleVault(); return }
      const backend = new LocalBackend(targetRef.id, targetRef.name, handle)
      const perm    = await backend.ensurePermission(false)
      if (perm === 'granted') {
        await activateWritableVault(backend)
      } else if (perm === 'prompt') {
        setActiveBackend(backend)
        setActiveVaultId(targetRef.id)
        setPendingReconnect(targetRef.name)
        await hydrateFromCache(targetRef.id)
        updateSyncUI()
      } else {
        await activateExampleVault()
      }
    } else if (targetRef.kind === 'github') {
      const token = await ensureFreshAccessToken(targetRef.id)
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
      const token = await ensureFreshAccessToken(id)
      if (!token) { notify('GitHub token not found — try removing and re-adding this vault.'); return }

      const backend = new GitHubBackend(id, ref.name, { ...ref.github, token })
      const perm    = await backend.ensurePermission(true)
      if (perm !== 'granted') { notify(`Could not connect to GitHub vault "${ref.name}" — check your token.`); return }

      await activateWritableVault(backend)
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    console.error('[vault] setActiveVault failed:', e)
    notifyError('Could not switch vault', e)
  }
}

export interface GitHubVaultConfig {
  owner:  string
  repo:   string
  branch: string
  token:  string
}

export async function addLocalVault(): Promise<void> {
  try {
    await cacheInit()
    const handle = await diskPickDirectory()
    const id     = crypto.randomUUID()

    await handleSave(id, handle)

    const ref: VaultRef = { id, name: handle.name, kind: 'local' }
    const backend = new LocalBackend(id, handle.name, handle)
    await registerAndActivate(ref, backend)
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    console.error('[vault] addLocalVault failed:', e)
    notifyError('Could not connect vault', e)
  }
}

export async function addGitHubVault(cfg: GitHubVaultConfig): Promise<void> {
  try {
    await cacheInit()
    const id = crypto.randomUUID()

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
    await registerAndActivate(ref, backend)
  } catch (e) {
    console.error('[vault] addGitHubVault failed:', e)
    notifyError('Could not connect GitHub vault', e)
  }
}

export interface GitHubOAuthVaultConfig {
  owner:        string
  repo:         string
  branch:       string
  accessToken:  string
  refreshToken: string
  expiresAt:    number
}

export async function addGitHubVaultOAuth(cfg: GitHubOAuthVaultConfig): Promise<void> {
  try {
    await cacheInit()
    const id = crypto.randomUUID()

    const backend = new GitHubBackend(id, `${cfg.owner}/${cfg.repo}`, {
      owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: cfg.accessToken,
    })
    const perm = await backend.ensurePermission(true)
    if (perm !== 'granted') {
      notify('Could not connect to GitHub repository — check the App has write access to it.')
      return
    }

    await tokenSave(id, cfg.accessToken)
    await refreshTokenSave(id, cfg.refreshToken)
    await tokenExpirySave(id, cfg.expiresAt)

    const ref: GitHubVaultRef = {
      id,
      name:   `${cfg.owner}/${cfg.repo}`,
      kind:   'github',
      github: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch },
    }
    await registerAndActivate(ref, backend)
  } catch (e) {
    console.error('[vault] addGitHubVaultOAuth failed:', e)
    notifyError('Could not connect GitHub vault', e)
  }
}

export async function removeVault(id: string): Promise<void> {
  try {
    const existing = await vaultRefsLoad()
    const ref      = existing.find(r => r.id === id)
    if (!ref) return

    // Switch away from the vault *before* removing it from the list, so the
    // store never renders an activeVaultId that points to a vault no longer in
    // `vaults`. Doing it in the other order leaves a transient inconsistent
    // snapshot that downstream reconciliation (e.g. the Settings dropdown)
    // latches onto.
    if (getActiveBackend()?.id === id) {
      await activateExampleVault()
    }

    if (ref.kind === 'local') await handleClear(id)
    if (ref.kind === 'github') {
      await tokenClear(id)
      await refreshTokenClear(id)
      await tokenExpiryClear(id)
    }

    await cacheDeleteAll(id)
    await updateVaultRefs(current => current.filter(r => r.id !== id))
  } catch (e) {
    console.error('[vault] removeVault failed:', e)
    notifyError('Could not remove vault', e)
  }
}
