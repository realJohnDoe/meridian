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
import { reconcileWithBackend, parseFiles, updateSyncUI, flushPendingPush } from './sync'
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

/**
 * The single source of truth for "which vault is active". The active-vault
 * identity lives in three places — the non-reactive backend singleton
 * (`activeBackend`), the reactive store field (`activeVaultId`), and the
 * persisted IndexedDB value — and they must always agree. Every activation path
 * funnels through here so no caller can update a subset and leave them diverged.
 *
 * `persist: false` is for the error-fallback path, which shows the example vault
 * *without* clobbering the saved id, so the next reload retries the real vault.
 */
async function setActiveVaultIdentity(
  backend: StorageBackend,
  opts: { pendingReconnect?: string | null; persist?: boolean } = {},
): Promise<void> {
  const { pendingReconnect = null, persist = true } = opts
  setActiveBackend(backend)
  setActiveVaultId(backend.id)
  setPendingReconnect(pendingReconnect)
  if (persist) await activeVaultIdSave(backend.id)
}

async function activateExampleVault(): Promise<void> {
  const backend = new ExampleBackend()
  await setActiveVaultIdentity(backend)
  const files = await backend.readAll()
  setData(parseFiles(files))
  updateSyncUI()
  emitVaultChanged()
}

async function activateWritableVault(backend: StorageBackend): Promise<void> {
  await setActiveVaultIdentity(backend)
  await hydrateFromCache(backend.id)
  await reconcileWithBackend(backend, backend.id)
  // Rescue anything a previous session left dirty in the cache instead of
  // waiting up to 60s for the first autoSyncTick.
  flushPendingPush()
  emitVaultChanged()
}

/** Builds the backend for a local/github ref, fetching its stored credential
 * (file handle or token). Returns `null` if the credential is missing. */
async function buildBackend(ref: VaultRef): Promise<StorageBackend | null> {
  if (ref.kind === 'local') {
    const handle = await handleLoad(ref.id)
    return handle ? new LocalBackend(ref.id, ref.name, handle) : null
  }
  if (ref.kind === 'github') {
    const token = await ensureFreshAccessToken(ref.id)
    return token ? new GitHubBackend(ref.id, ref.name, { ...ref.github, token }) : null
  }
  return null
}

type ActivationOutcome = 'granted' | 'prompt' | 'denied' | 'no-credential'

/**
 * Shared local/github activation flow used by both the restore-on-load path
 * and the user-initiated switch path. Builds the backend, checks permission,
 * and activates on success; callers only need to react to the outcome for
 * their own fallback/notification policy.
 *
 * `interactive: false` (restore) surfaces a `'prompt'` outcome by parking the
 * vault in pending-reconnect state instead of activating it. `interactive:
 * true` (user switch) actively requests permission, which never resolves to
 * `'prompt'`.
 */
async function activateVaultRef(ref: VaultRef, interactive: boolean): Promise<ActivationOutcome> {
  const backend = await buildBackend(ref)
  if (!backend) return 'no-credential'

  const perm = await backend.ensurePermission(interactive)
  if (perm === 'granted') {
    await activateWritableVault(backend)
    return 'granted'
  }
  if (perm === 'prompt' && !interactive) {
    await setActiveVaultIdentity(backend, { pendingReconnect: ref.name })
    await hydrateFromCache(ref.id)
    updateSyncUI()
    return 'prompt'
  }
  return 'denied'
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
    setVaultList([EXAMPLE_REF])
    await setActiveVaultIdentity(backend, { persist: false })
    setData(parseFiles(await backend.readAll()))
  }

  try {
    await cacheInit()

    const savedRefs = await vaultRefsLoad()
    const allRefs: VaultRef[] = [EXAMPLE_REF, ...savedRefs]
    setVaultList(allRefs)

    const savedActiveId = await activeVaultIdLoad()
    const targetRef     = allRefs.find(r => r.id === savedActiveId) ?? EXAMPLE_REF

    if (targetRef.kind === 'local' || targetRef.kind === 'github') {
      const outcome = await activateVaultRef(targetRef, false)
      if (outcome === 'no-credential') { await activateExampleVault(); return }
      if (outcome === 'denied') {
        if (targetRef.kind === 'github') {
          notify(`Could not reconnect GitHub vault "${targetRef.name}" — check your token.`)
        }
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

    if (ref.kind === 'local' || ref.kind === 'github') {
      const outcome = await activateVaultRef(ref, true)
      if (outcome === 'no-credential') {
        notify(ref.kind === 'local'
          ? 'Vault handle not found — try removing and re-adding it.'
          : 'GitHub token not found — try removing and re-adding this vault.')
        return
      }
      if (outcome !== 'granted') {
        notify(ref.kind === 'local'
          ? `Permission denied for vault "${ref.name}".`
          : `Could not connect to GitHub vault "${ref.name}" — check your token.`)
        return
      }
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
