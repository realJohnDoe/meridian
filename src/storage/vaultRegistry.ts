import {
  cacheInit, cacheLoadAll, applyRemoteBatch, cacheDeleteAll,
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
import { ensureFreshAccessToken } from './githubOAuth'
import type { StorageBackend } from './backend'
import type { VaultRef, GitHubVaultRef } from '@/types'
import { setData, getVaults, setVaultList, setActiveVaultId, setPendingReconnect, setVaultLoading, setVaultLoadProgress, setUnreadableFiles } from '@/storeBridge'
import { notify, notifyError, warn } from './notifications'
import { getActiveBackend, setActiveBackend } from './activeBackend'
import { syncOnActivate, parseFiles, reportParseFailures, reportRoundTripLosses, updateSyncUI } from './sync'
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

/**
 * Paints the store from the Dexie cache. Returns whether there was anything
 * to paint — the caller uses that to decide whether the skeleton can come
 * down now or must stay up until the first sync fills the store.
 */
async function hydrateFromCache(vaultId: string): Promise<boolean> {
  const cached = await cacheLoadAll(vaultId)
  if (cached.length === 0) {
    // Clear rather than return early: leaving the previous vault's items in
    // the store makes a switch to a never-loaded vault show the old vault's
    // entries, and the reconcile that follows won't evict them
    // (mergeChangedIntoStore preserves unaffected slugs).
    setData({ items: [], roots: new Map() })
    setUnreadableFiles(new Map())
    return false
  }
  const { items, roots, failures, lossy } = parseFiles(cached)
  setData({ items, roots })
  setUnreadableFiles(new Map(failures.map(f => [f.slug, { path: f.path, message: f.message }])))
  reportParseFailures(failures)
  reportRoundTripLosses(lossy)
  return true
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

/**
 * `persist: false` shows the tutorial content *without* overwriting the
 * saved active-vault id. Every "your real vault is temporarily unusable"
 * path must use it: the saved id is the user's choice and has to survive a
 * bad token or a mid-restore crash, so the next reload goes straight back to
 * their vault rather than being stuck on the tutorial forever.
 */
async function activateExampleVault(opts: { persist?: boolean } = {}): Promise<void> {
  const backend = new ExampleBackend()
  await setActiveVaultIdentity(backend, { persist: opts.persist ?? true })
  const files = await backend.readAll()
  const { items, roots, failures, lossy } = parseFiles(files)
  setData({ items, roots })
  setUnreadableFiles(new Map(failures.map(f => [f.slug, { path: f.path, message: f.message }])))
  reportParseFailures(failures)
  reportRoundTripLosses(lossy)
  updateSyncUI()
  emitVaultChanged()
}

/**
 * Activate a writable backend: claim the identity, paint whatever the cache
 * holds, then sync in the background.
 *
 * `prePainted` means the caller already ran hydrateFromCache for this vault
 * id *before* the network work started (the whole point of the cache-first
 * restore) — so we don't read the same rows out of Dexie twice.
 *
 * The first sync is deliberately not awaited when something is on screen:
 * statAll + readFiles + Dexie writes take seconds on a large vault, and the
 * user is already looking at correct content — the sync only refines it. It
 * IS awaited when the cache was empty, because then the skeleton is the only
 * thing on screen and clearing it early would flash an empty agenda.
 *
 * syncOnActivate also subsumes the old flushPendingPush() call here: its
 * pushDirty leg rescues anything a previous session left dirty, in the same
 * cycle as the reconcile rather than as a second racing one.
 */
async function activateWritableVault(backend: StorageBackend, prePainted = false): Promise<void> {
  await setActiveVaultIdentity(backend)
  const painted = prePainted || await hydrateFromCache(backend.id)
  updateSyncUI()
  emitVaultChanged()

  if (painted) {
    setVaultLoading(false)
    // .catch is belt-and-braces: runSync swallows its own errors, so this can
    // only ever fire if that invariant is broken later.
    void syncOnActivate().catch(e => console.warn('[vault] activation sync failed:', e))
  } else {
    await syncOnActivate()
  }
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
    if (!token) return null
    const { GitHubBackend } = await import('./githubBackend')
    return new GitHubBackend(ref.id, ref.name, { ...ref.github, token })
  }
  return null
}

type ActivationOutcome = 'granted' | 'offline' | 'prompt' | 'denied' | 'no-credential'

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
 *
 * `prePainted` says the caller already hydrated this vault from cache (the
 * restore path does, before any network work) so neither branch below reads
 * the same Dexie rows a second time.
 */
async function activateVaultRef(
  ref: VaultRef, interactive: boolean, prePainted = false,
): Promise<ActivationOutcome> {
  const backend = await buildBackend(ref)
  if (!backend) return 'no-credential'

  const perm = await backend.ensurePermission(interactive)
  // 'unreachable' is emphatically not 'denied': the credential is fine, the
  // network isn't. Activate exactly as for 'granted' — writable, hydrated
  // from cache — so offline edits are recorded as dirty in Dexie and pushed
  // on reconnect. syncOffline and the retry backoff are set by the background
  // sync's own transient classification in runSync, not here, so there stays
  // exactly one writer for that state.
  if (perm === 'granted' || perm === 'unreachable') {
    await activateWritableVault(backend, prePainted)
    return perm === 'granted' ? 'granted' : 'offline'
  }
  if (perm === 'prompt' && !interactive) {
    await setActiveVaultIdentity(backend, { pendingReconnect: ref.name })
    if (!prePainted) await hydrateFromCache(ref.id)
    updateSyncUI()
    return 'prompt'
  }
  return 'denied'
}

async function registerAndActivate(ref: VaultRef, backend: StorageBackend): Promise<void> {
  await updateVaultRefs(existing => [...existing, ref])
  try {
    const files = await backend.readAll((loaded, total) => setVaultLoadProgress({ loaded, total }))
    await applyRemoteBatch(backend.id, files)
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
    setVaultList([EXAMPLE_REF])
    await activateExampleVault({ persist: false })
  }

  try {
    await cacheInit()

    const savedRefs = await vaultRefsLoad()
    const allRefs: VaultRef[] = [EXAMPLE_REF, ...savedRefs]
    setVaultList(allRefs)

    const savedActiveId = await activeVaultIdLoad()
    const targetRef     = allRefs.find(r => r.id === savedActiveId) ?? EXAMPLE_REF

    if (targetRef.kind === 'local' || targetRef.kind === 'github') {
      // ── Cache-first paint ──────────────────────────────────────────
      // One indexed Dexie query; no network, no credential, no permission
      // check. Everything after this line — buildBackend's possible OAuth
      // refresh POST to the Worker (GitHub App tokens last 8h, so most
      // first-open-of-the-day restores hit it), ensurePermission's two round
      // trips, then statAll + readFiles — only *refines* content the user can
      // already see. None of it may gate first paint.
      //
      // Only the store's items/roots are written here: the active-vault
      // identity is still claimed by activateVaultRef after the permission
      // check, so nothing observes a half-activated vault.
      const prePainted = await hydrateFromCache(targetRef.id)
      if (prePainted) setVaultLoading(false)

      const outcome = await activateVaultRef(targetRef, false, prePainted)
      // persist: false on both fallback branches below — a bad token or
      // missing credential must not cost the user their vault selection.
      // Persisting 'example' here would strand them on the tutorial even
      // after they fix the token, until they manually re-select the vault.
      if (outcome === 'no-credential') { await activateExampleVault({ persist: false }); return }
      if (outcome === 'denied') {
        if (targetRef.kind === 'github') {
          notify(`Could not reconnect GitHub vault "${targetRef.name}" — check your token.`)
        }
        await activateExampleVault({ persist: false })
      }
      // 'granted' | 'offline' | 'prompt' — nothing further to do.
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
      if (outcome === 'offline') {
        // The vault IS active and writable — opened from its local copy. A
        // warning, not an error: nothing is broken and nothing is lost.
        warn(`You're offline — "${ref.name}" opened from your local copy. Changes will sync when you reconnect.`)
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

    const { GitHubBackend } = await import('./githubBackend')
    const backend = new GitHubBackend(id, `${cfg.owner}/${cfg.repo}`, cfg)
    const perm    = await backend.ensurePermission(true)
    if (perm === 'unreachable') {
      notify("You're offline — connecting a GitHub vault needs a network connection.")
      return
    }
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

    const { GitHubBackend } = await import('./githubBackend')
    const backend = new GitHubBackend(id, `${cfg.owner}/${cfg.repo}`, {
      owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: cfg.accessToken,
    })
    const perm = await backend.ensurePermission(true)
    if (perm === 'unreachable') {
      notify("You're offline — connecting a GitHub vault needs a network connection.")
      return
    }
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
