import { cacheInit } from '@/storage/cache/db'
import { cacheLoadAll, applyRemoteBatch, cacheDeleteAll } from '@/storage/cache/files'
import {
  handleSave, handleLoad, handleClear,
  tokenClear, refreshTokenClear, tokenExpiryClear,
  credentialsSave,
} from '@/storage/cache/credentials'
import {
  vaultRefsSave, vaultRefsLoad, activeVaultIdSave, activeVaultIdLoad,
  exampleVaultRemovedLoad, exampleVaultRemovedSave,
} from '@/storage/cache/registry'
import { titleToSlug, keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { diskPickDirectory } from './fs'
import { LocalBackend }   from './localBackend'
import { ExampleBackend } from './exampleBackend'
import { ensureFreshAccessToken } from './githubOAuth'
import type { StorageBackend } from './backend'
import { isWritableVault } from '@/vaultRef'
import type { VaultRef, GitHubVaultRef, IcalVaultRef } from '@/vaultRef'
import {
  getVaults, setStoreState, setVaultLayer, removeVaultLayer,
  setVaultSync, removeVaultSync, getUnreadableFiles, setUnreadableFiles,
  loadGlobalPrefs, loadDefaultParticipants, getDefaultVaultId, setDefaultVaultId,
} from '@/storeBridge'
import { notify, notifyError, warn } from './notifications'
import { mountBackend, unmountBackend } from './backends'
import { syncOnActivate, parseFiles, reportParseFailures, updateSyncUI, dropSyncState } from './sync'

// ── VAULT-CHANGE NOTIFICATION ──────────────────────────────────

export interface VaultChange {
  /**
   * Whether this change replaced content the calendar had already derived
   * views from.
   *
   * False on the cache-first restore path, where `hydrateFromCache` painted
   * these same vaults before activation even started — so everything derived
   * from that content (cached expansions, agenda sections, scroll position) is
   * still valid and must not be thrown away. Discarding it there cost a full
   * re-expansion and re-grouping on the critical path to the agenda's first
   * correct frame, for content that had not changed.
   *
   * True when a vault is registered or removed, and for a restore whose caches
   * were all empty — all of which do change what the agenda is grouping.
   */
  contentReplaced: boolean
}

const _vaultChangedListeners = new Set<(change: VaultChange) => void>()

export function onVaultChanged(fn: (change: VaultChange) => void): () => void {
  _vaultChangedListeners.add(fn)
  return () => _vaultChangedListeners.delete(fn)
}

function emitVaultChanged(change: VaultChange): void {
  _vaultChangedListeners.forEach(fn => fn(change))
}

// ── CONSTANTS ─────────────────────────────────────────────────

const EXAMPLE_REF: VaultRef = { id: 'example', name: 'Tutorial', kind: 'example' }

/**
 * Kinds that accept writes — the candidates for `defaultVaultId`.
 *
 * The predicate itself lives on `vaultRef.ts` because `components/` asks the
 * same question (which vaults the editor's chip may offer as a move target)
 * and may not import `@/storage`.
 */
const isWritableKind = isWritableVault

/**
 * Every persisted vault is mountable; only the synthesized Tutorial vault is
 * not, because it is never in the persisted list to begin with.
 *
 * Deliberately not `isWritableKind`: a calendar subscription is read-only but
 * mounts, caches and syncs exactly like any other vault — that equivalence is
 * the whole point of splitting writability out of the vault lifecycle. The two
 * predicates answer different questions and must not be collapsed.
 */
function isMountableKind(ref: VaultRef): boolean {
  return ref.kind !== 'example'
}

// ── VAULT IDS ─────────────────────────────────────────────────

/**
 * A readable id for a brand-new vault, derived once at creation and then
 * persisted — never regenerated.
 *
 * The id is the single identity: the Dexie partition key (`vp(vaultId, path)`),
 * the credential key, the localStorage pref suffix, **and** the URL segment
 * (`/entry/<vault>/<slug>`). That last use is why it stops being a UUID: a
 * bookmark reading `/entry/realjohndoe-meridian/meeting-notes` is legible where
 * one reading `/entry/3f2a5c9e-…/meeting-notes` is not.
 *
 * It cannot be *derived* from the vault's properties, which is why it is
 * assigned rather than computed: `owner/repo@branch` is a genuine natural key
 * but contains `/` and `@` (unusable as a path segment); a local folder's name
 * is neither unique nor stable across re-picking; and an iCal URL is unique but
 * is the user's secret address. So it is assigned once, from the name, and
 * uniquified against the ids already taken — including `example`, which the
 * synthesized Tutorial vault always holds.
 *
 * Vaults that already exist keep their UUIDs. There is no migration, and that
 * is deliberate: moving an id would have to move Dexie rows, a GitHub token and
 * an FS handle in lockstep, and a half-applied move orphans a credential. The
 * trade is that their URLs stay ugly until they are re-added.
 */
export function newVaultId(name: string, taken: Set<string>): string {
  const base = titleToSlug(name)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Ids already in use — the persisted vaults plus the synthesized Tutorial one. */
async function takenVaultIds(): Promise<Set<string>> {
  const existing = await vaultRefsLoad()
  return new Set([EXAMPLE_REF.id, ...existing.map(r => r.id)])
}

// ── REGISTRY HELPER ───────────────────────────────────────────

async function updateVaultRefs(mutate: (current: VaultRef[]) => VaultRef[]): Promise<void> {
  const current = await vaultRefsLoad()
  const updated = mutate(current)
  await vaultRefsSave(updated)
  const vaults = (await exampleVaultRemovedLoad()) ? updated : [EXAMPLE_REF, ...updated]
  setStoreState({ vaults })
  // Favourites and the view filter span every registered vault at once, so the
  // registered set changing is exactly when they must be re-read.
  loadGlobalPrefs(vaults.map(r => r.id))
}

/**
 * Unregister the Tutorial vault.
 *
 * Separate from the generic `removeVault` path below because the Tutorial
 * vault is never one of the refs `updateVaultRefs` persists — it is
 * synthesized, not backed by a credential — so its "removed" state is its own
 * flag rather than an absence from that list. Idempotent: safe to call
 * whether or not the vault is currently mounted.
 */
async function removeExampleVault(): Promise<void> {
  unmountBackend(EXAMPLE_REF.id)
  dropSyncState(EXAMPLE_REF.id)
  removeVaultLayer(EXAMPLE_REF.id)
  removeVaultSync(EXAMPLE_REF.id)
  await exampleVaultRemovedSave(true)
  const vaults = getVaults().filter(v => v.id !== EXAMPLE_REF.id)
  setStoreState({ vaults })
  loadGlobalPrefs(vaults.map(r => r.id))
  reconcileDefaultVault(vaults)
  emitVaultChanged({ contentReplaced: true })
}

// ── DEFAULT VAULT ─────────────────────────────────────────────

/**
 * Keep `defaultVaultId` pointing at a registered, writable vault.
 *
 * Called after anything that changes the registered set. The default is where
 * new entries go, so it must never dangle at a removed vault (saves would be
 * refused by `writeEntityToCache`, silently) nor at a read-only one. `prefer`
 * is consulted first — the legacy `activeVaultId` on the restore path, the
 * freshly added vault on the add path.
 */
function reconcileDefaultVault(refs: VaultRef[], prefer?: string | null): void {
  const writable = refs.filter(isWritableKind)
  const current  = getDefaultVaultId()
  if (current && writable.some(r => r.id === current)) return
  const next = writable.find(r => r.id === prefer)?.id ?? writable[0]?.id ?? null
  setDefaultVaultId(next)
  // The one lazily-loaded per-vault pref follows the default: it seeds new
  // entries, and a new entry goes to the default vault.
  if (next) loadDefaultParticipants(next)
}

// ── ACTIVATION HELPERS ─────────────────────────────────────────

/**
 * Replace this vault's contribution to `unreadableFiles`, leaving every other
 * vault's entries alone. The map is global and keyed by `EntryKey`, so the
 * vault half of the key is what makes the partition exact.
 */
function setVaultUnreadable(
  vaultId: string, failures: Array<{ key: EntryKey; path: string; message: string }>,
): void {
  const next = new Map(
    [...getUnreadableFiles()].filter(([key]) => keyVaultId(key) !== vaultId),
  )
  for (const f of failures) next.set(f.key, { path: f.path, message: f.message })
  setUnreadableFiles(next)
}

/**
 * Paints one vault's layer from the Dexie cache. Returns whether there was
 * anything to paint — the caller uses that to decide whether the skeleton can
 * come down now or must stay up until the first sync fills the store.
 */
async function hydrateFromCache(vaultId: string): Promise<boolean> {
  const cached = await cacheLoadAll(vaultId)
  if (cached.length === 0) {
    // An empty layer, not a missing one: the vault is registered, so it must
    // be a key in `layers` for `getVaultLayer` to report it as present.
    setVaultLayer(vaultId, { items: [], roots: new Map() })
    setVaultUnreadable(vaultId, [])
    return false
  }
  const { items, roots, failures, auditRoundTrip } = parseFiles(cached, vaultId)
  setVaultLayer(vaultId, { items, roots })
  setVaultUnreadable(vaultId, failures)
  reportParseFailures(failures)
  auditRoundTrip()
  return true
}

/**
 * Mount the Tutorial vault and load its synthesized content.
 *
 * Stays on its own cache-free path — no Dexie rows, no `runSync` — because its
 * files are generated fresh on every load and there is no remote to reconcile
 * against. Only the *store write* is an ordinary layer write like every other
 * backend's: the old `setData(...)` replaced the whole store, which was
 * harmless when this was the only vault but would now wipe out every other
 * registered vault's content the moment the Tutorial vault (re-)mounts.
 */
async function mountExampleVault(): Promise<void> {
  const backend = new ExampleBackend()
  mountBackend(backend)
  const files = await backend.readAll()
  const { items, roots, failures, auditRoundTrip } = parseFiles(files, backend.id)
  setVaultLayer(backend.id, { items, roots })
  setVaultUnreadable(backend.id, failures)
  reportParseFailures(failures)
  auditRoundTrip()
  updateSyncUI(backend)
}

/**
 * Load a vault's content — paint whatever the cache holds, then sync in the
 * background.
 *
 * `prePainted` means the caller already ran hydrateFromCache for this vault
 * *before* the network work started (the whole point of the cache-first
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
async function loadVaultContent(backend: StorageBackend, prePainted = false): Promise<void> {
  const painted = prePainted || await hydrateFromCache(backend.id)
  updateSyncUI(backend)

  if (painted) {
    setStoreState({ vaultLoading: false })
    // .catch is belt-and-braces: runSync swallows its own errors, so this can
    // only ever fire if that invariant is broken later.
    void syncOnActivate(backend).catch((e: unknown) => console.warn('[vault] activation sync failed:', e))
  } else {
    await syncOnActivate(backend)
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
    // A refresh that failed transiently, or a credential GitHub has since
    // refused, still hands back the last known token — the backend is built
    // with it and the first API call becomes the real test, which is where the
    // sync path's classification and recovery already live. Only "nothing
    // stored at all" is a reason not to build one.
    const result = await ensureFreshAccessToken(ref.id)
    if (result.status === 'no-credential') return null
    const { GitHubBackend } = await import('./githubBackend')
    return new GitHubBackend(ref.id, ref.name, { ...ref.github, token: result.token })
  }
  if (ref.kind === 'ical') {
    // The feed URL travels on the ref, so a subscription has no credential to
    // be missing — it can always build a backend.
    const { IcalBackend } = await import('./icalBackend')
    return new IcalBackend(ref.id, ref.name, ref.ical.url)
  }
  return null
}

type MountOutcome = 'granted' | 'offline' | 'prompt' | 'denied' | 'no-credential'

/**
 * Mount one local/github vault: build its backend, check permission, register
 * it in the backend map, and load its content.
 *
 * `interactive: false` (restore) surfaces a `'prompt'` outcome by mounting the
 * vault in needs-reconnect state instead of syncing it — its cached content
 * still paints, so the entries are readable, they just can't be refreshed
 * until the user grants permission. `interactive: true` (a reconnect click)
 * actively requests permission, which never resolves to `'prompt'`. This
 * applies to `local` only — a `github`/`ical` ref skips the probe entirely on
 * a non-interactive restore; see the check below.
 *
 * `prePainted` says the caller already hydrated this vault from cache (the
 * restore path does, before any network work) so neither branch below reads
 * the same Dexie rows a second time.
 */
async function mountVaultRef(
  ref: VaultRef, interactive: boolean, prePainted = false,
): Promise<MountOutcome> {
  const backend = await buildBackend(ref)
  if (!backend) return 'no-credential'

  // A network backend has no permission gate, only failures — the first sync
  // IS the probe. Skip it on restore (interactive: false) so one dropped
  // request can no longer leave the vault unmounted for the rest of the
  // session; runSync's own classification, retry and backoff take over from
  // here. A reconnect click (interactive: true) still probes, because a
  // human is waiting on the answer.
  if ((ref.kind === 'github' || ref.kind === 'ical') && !interactive) {
    mountBackend(backend)
    setVaultSync(ref.id, { needsAttention: null })
    await loadVaultContent(backend, prePainted)
    return 'granted'
  }

  const perm = await backend.ensurePermission(interactive)
  // 'unreachable' is emphatically not 'denied': the credential is fine, the
  // network isn't. Mount exactly as for 'granted' — writable, hydrated from
  // cache — so offline edits are recorded as dirty in Dexie and pushed on
  // reconnect. The offline flag and the retry backoff are set by the
  // background sync's own transient classification in runSync, not here, so
  // there stays exactly one writer for that state.
  if (perm === 'granted' || perm === 'unreachable') {
    mountBackend(backend)
    setVaultSync(ref.id, { needsAttention: null })
    await loadVaultContent(backend, prePainted)
    return perm === 'granted' ? 'granted' : 'offline'
  }
  if (perm === 'prompt' && !interactive) {
    // Mounted, but flagged: the scheduler will attempt it and fail harmlessly
    // until the user clicks through from SyncButton's popover.
    mountBackend(backend)
    setVaultSync(ref.id, {
      needsAttention: { kind: 'fs-permission', message: `Permission needed for "${ref.name}" — reconnect.` },
    })
    if (!prePainted) await hydrateFromCache(ref.id)
    updateSyncUI(backend)
    return 'prompt'
  }
  return 'denied'
}

async function registerAndMount(ref: VaultRef, backend: StorageBackend): Promise<void> {
  // Any real vault, not only a writable one: once a subscription is showing the
  // user their own calendar, the tutorial's sample entries are noise in that
  // same agenda.
  const wasFirstRealVault = (await vaultRefsLoad()).filter(isMountableKind).length === 0
  await updateVaultRefs(existing => [...existing, ref])
  try {
    mountBackend(backend)
    const files = await backend.readAll((loaded, total) => setStoreState({ vaultLoadProgress: { loaded, total } }))
    await applyRemoteBatch(backend.id, files)
    reconcileDefaultVault(getVaults(), ref.id)
    // Once a real vault is showing the user their own calendar, the
    // Tutorial's sample entries are noise in that same agenda — remove it by
    // default, the same as if the user had removed it themselves. A no-op if
    // it was already removed (e.g. the user removed it earlier this session).
    if (wasFirstRealVault) await removeExampleVault().catch((e: unknown) => console.warn('[vault] removeExampleVault failed:', e))
    await loadVaultContent(backend)
    emitVaultChanged({ contentReplaced: true })
  } finally {
    // Reset even on a thrown/failed load, so a retry (or the next vault) never
    // inherits a stale "N of M" from an aborted first connect.
    setStoreState({ vaultLoadProgress: null })
  }
}

// ── VAULT LIFECYCLE ───────────────────────────────────────────

export async function restoreVaults(): Promise<void> {
  try {
    await restoreVaultsInner()
  } finally {
    setStoreState({ vaultLoading: false })
  }
}

/**
 * Mount every registered vault, not just one.
 *
 * Registered *is* mounted under the multi-vault model: there is no "active"
 * vault to pick, so the restore is a loop rather than a choice. The two-phase
 * shape is what keeps first paint fast — every vault's cache is painted before
 * *any* vault's credentials, permission probes or network round trips are
 * touched, so the agenda renders from Dexie in one pass instead of waiting on
 * the slowest vault's OAuth refresh.
 *
 * Failures are per vault: a GitHub vault with a dead token leaves its cached
 * entries on screen and does not stop the local folder beside it from syncing.
 */
async function restoreVaultsInner(): Promise<void> {
  try {
    await cacheInit()

    const savedRefs = await vaultRefsLoad()
    const mountable = savedRefs.filter(isMountableKind)

    // `null` means no decision has ever been recorded — either a fresh
    // install, or one that predates this flag. An install that predates it
    // and already has a real vault already dismissed the Tutorial vault under
    // the old one-time hide-from-the-filter behavior; migrate that into an
    // explicit removal, once, rather than resurrecting it. A fresh install
    // (no real vault yet) keeps the Tutorial vault registered.
    let exampleRemoved = await exampleVaultRemovedLoad()
    if (exampleRemoved === null) {
      exampleRemoved = mountable.length > 0
      await exampleVaultRemovedSave(exampleRemoved)
    }

    const allRefs: VaultRef[] = exampleRemoved ? savedRefs : [EXAMPLE_REF, ...savedRefs]
    setStoreState({ vaults: allRefs })
    loadGlobalPrefs(allRefs.map(r => r.id))

    // The legacy single-vault pointer, still the best guess at which vault the
    // user thinks of as theirs. Only consulted when no default has been chosen
    // under the new model.
    reconcileDefaultVault(allRefs, await activeVaultIdLoad())

    // ── Phase 1: cache-first paint, every vault ─────────────────────
    // One indexed Dexie query per vault; no network, no credential, no
    // permission check. Everything in phase 2 — buildBackend's possible OAuth
    // refresh POST to the Worker (GitHub App tokens last 8h, so most
    // first-open-of-the-day restores hit it), ensurePermission's two round
    // trips, then statAll + readFiles — only *refines* content the user can
    // already see. None of it may gate first paint.
    const prePainted = new Map<string, boolean>()
    for (const ref of mountable) {
      prePainted.set(ref.id, await hydrateFromCache(ref.id))
    }

    // The Tutorial vault is cache-free and cheap (synthesized in memory), so
    // it is mounted here rather than in either phase's loop — only when it is
    // still registered; once removed it stays unmounted like any other vault.
    if (!exampleRemoved) await mountExampleVault()

    // ── The paint gate ──────────────────────────────────────────────
    // Released only once *every* cached vault — the Tutorial vault included —
    // is in the store, never after the first one lands.
    //
    // The agenda seeds its scroll position from the row list it first mounts
    // with (see computeAgendaScrollRestore), so a vault whose layer arrives after
    // that inserts rows above the viewport and shifts the day on screen. The
    // anchoring in AgendaView recovers from it, but recovery is approximate —
    // it re-pins to an estimated row position — and there is no reason to need
    // it here: phase 1 is all indexed Dexie reads, so waiting for the rest of
    // it costs a few milliseconds and makes the first frame the correct one.
    //
    // This is why a lone GitHub vault always looked fine while GitHub +
    // Tutorial or GitHub + iCal drifted: nothing to do with the vault kinds
    // (they hydrate through this identical loop), only with whether a second
    // layer landed after the gate had already been released.
    if ([...prePainted.values()].some(Boolean)) setStoreState({ vaultLoading: false })

    // ── Phase 2: credentials, permission, first sync ────────────────
    for (const ref of mountable) {
      try {
        const outcome = await mountVaultRef(ref, false, prePainted.get(ref.id) ?? false)
        if (outcome === 'no-credential') {
          warn(ref.kind === 'local'
            ? `Vault "${ref.name}" is missing its folder permission — remove and re-add it.`
            : `Vault "${ref.name}" isn't signed in to GitHub — sign in again.`)
        }
        // `github`/`ical` skip the probe on restore (see mountVaultRef), so
        // `outcome` is always 'granted' for them here — never 'denied', never
        // 'prompt'. A dropped request just means a failed first sync, which
        // runSync retries on its own; there is nothing to notify about.
      } catch (e) {
        // One vault's failure must not abort the others' restore.
        console.warn(`[vault] could not mount "${ref.name}":`, e)
      }
    }

    emitVaultChanged({ contentReplaced: ![...prePainted.values()].some(Boolean) })
  } catch (e) {
    console.warn('[vault] restoreVaults failed:', e)
    // Even a total failure leaves the Tutorial vault, so the app has content.
    await mountExampleVault().catch(() => {})
  }
}

/**
 * Re-request filesystem permission for a local vault the restore parked in
 * needs-reconnect state, and finish mounting it on success.
 *
 * This is what the "Permission needed" row in `SyncButton`'s popover clicks
 * through to. It has to be driven by a user gesture — that is the whole reason
 * the restore path cannot do it — which is why it lives here rather than in the
 * scheduler.
 */
export async function reconnectVault(id: string): Promise<void> {
  try {
    const ref = getVaults().find(v => v.id === id)
    if (!ref || !isWritableKind(ref)) return

    const outcome = await mountVaultRef(ref, true)
    if (outcome === 'no-credential') {
      notify(ref.kind === 'local'
        ? 'Vault handle not found — try removing and re-adding it.'
        : `"${ref.name}" isn't signed in to GitHub — sign in again.`)
      return
    }
    if (outcome === 'offline') {
      // The vault IS mounted and writable — opened from its local copy. A
      // warning, not an error: nothing is broken and nothing is lost.
      warn(`You're offline — "${ref.name}" opened from your local copy. Changes will sync when you reconnect.`)
      return
    }
    if (outcome !== 'granted') {
      notify(ref.kind === 'local'
        ? `Permission denied for vault "${ref.name}".`
        : `Could not connect to "${ref.name}" — sign in to GitHub again.`)
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    console.error('[vault] reconnectVault failed:', e)
    notifyError('Could not reconnect vault', e)
  }
}

/**
 * Choose which vault new entries go to. Purely a preference write — every
 * registered vault is already mounted and synced, so nothing loads, unloads or
 * re-syncs here. That is the whole point of splitting `activeVaultId` apart.
 */
export function setDefaultVault(id: string): void {
  const ref = getVaults().find(v => v.id === id)
  if (!ref || !isWritableKind(ref)) return
  setDefaultVaultId(id)
  loadDefaultParticipants(id)
  void activeVaultIdSave(id)
}

/**
 * Rename a registered vault. The id — and so every URL, Dexie row, credential
 * key and pref key keyed off it — is untouched; only the display name changes.
 *
 * A no-op for the synthesized Tutorial vault: it is never in the persisted
 * list `updateVaultRefs` maps over, so `id: 'example'` simply matches nothing.
 */
export async function renameVault(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  await updateVaultRefs(current => current.map(r => (r.id === id ? { ...r, name: trimmed } : r)))
}

export async function addLocalVault(): Promise<void> {
  try {
    await cacheInit()
    const handle = await diskPickDirectory()
    const id     = newVaultId(handle.name, await takenVaultIds())

    await handleSave(id, handle)

    const ref: VaultRef = { id, name: handle.name, kind: 'local' }
    const backend = new LocalBackend(id, handle.name, handle)
    await registerAndMount(ref, backend)
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    console.error('[vault] addLocalVault failed:', e)
    notifyError('Could not connect vault', e)
  }
}

/**
 * Re-register the Tutorial vault after it has been removed. A no-op if it is
 * already registered.
 */
export async function addExampleVault(): Promise<void> {
  try {
    await cacheInit()
    if (!(await exampleVaultRemovedLoad())) return
    await exampleVaultRemovedSave(false)
    const vaults = [EXAMPLE_REF, ...getVaults().filter(v => v.id !== EXAMPLE_REF.id)]
    setStoreState({ vaults })
    loadGlobalPrefs(vaults.map(r => r.id))
    await mountExampleVault()
    emitVaultChanged({ contentReplaced: true })
  } catch (e) {
    console.error('[vault] addExampleVault failed:', e)
    notifyError('Could not add Tutorial vault', e)
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
    const id = newVaultId(`${cfg.owner}/${cfg.repo}`, await takenVaultIds())

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

    await credentialsSave(id, { accessToken: cfg.accessToken, refreshToken: cfg.refreshToken, expiresAt: cfg.expiresAt })

    const ref: GitHubVaultRef = {
      id,
      name:   `${cfg.owner}/${cfg.repo}`,
      kind:   'github',
      github: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch },
    }
    await registerAndMount(ref, backend)
  } catch (e) {
    console.error('[vault] addGitHubVaultOAuth failed:', e)
    notifyError('Could not connect GitHub vault', e)
  }
}

/**
 * Register a calendar subscription.
 *
 * The feed is fetched once before anything is persisted, so a typo'd or
 * unreachable URL fails here — in the wizard, where it is still cheap to
 * correct — rather than producing a permanently empty vault. `previewIcalFeed`
 * has usually already done this a moment earlier, and `IcalBackend` memoizes,
 * so the check normally costs nothing.
 */
export async function addIcalVault(feedUrl: string, name: string): Promise<void> {
  try {
    await cacheInit()
    const id = newVaultId(name, await takenVaultIds())

    const { IcalBackend } = await import('./icalBackend')
    const backend = new IcalBackend(id, name, feedUrl)
    if (await backend.ensurePermission(true) !== 'granted') {
      notify(`Could not read the calendar at that address. Check the URL and your connection.`)
      return
    }

    const ref: IcalVaultRef = { id, name, kind: 'ical', ical: { url: feedUrl } }
    await registerAndMount(ref, backend)
  } catch (e) {
    console.error('[vault] addIcalVault failed:', e)
    notifyError('Could not add calendar subscription', e)
  }
}

/**
 * Unregister a vault: unmount its backend, drop its layer and its sync state,
 * clear its credential, and delete its cache rows.
 *
 * Unmount before anything else. A reconcile started by the scheduler can still
 * be in flight, and `reconcileWithBackend` re-checks `getBackend(vaultId)`
 * before merging — so removing the backend first is what stops a late-landing
 * cycle from resurrecting the layer this is about to drop.
 *
 * The Tutorial vault is never in the persisted list this walks — it goes
 * through `removeExampleVault` instead, which the id check below dispatches
 * to first.
 */
export async function removeVault(id: string): Promise<void> {
  try {
    if (id === EXAMPLE_REF.id) {
      await removeExampleVault()
      return
    }

    const existing = await vaultRefsLoad()
    const ref      = existing.find(r => r.id === id)
    if (!ref) return

    unmountBackend(id)
    dropSyncState(id)
    removeVaultLayer(id)
    removeVaultSync(id)

    if (ref.kind === 'local') await handleClear(id)
    if (ref.kind === 'github') {
      await tokenClear(id)
      await refreshTokenClear(id)
      await tokenExpiryClear(id)
    }

    await cacheDeleteAll(id)
    await updateVaultRefs(current => current.filter(r => r.id !== id))
    // Only after `vaults` no longer lists it, so the replacement is chosen
    // from what actually remains.
    reconcileDefaultVault(getVaults())
    emitVaultChanged({ contentReplaced: true })
  } catch (e) {
    console.error('[vault] removeVault failed:', e)
    notifyError('Could not remove vault', e)
  }
}

