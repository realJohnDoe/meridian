import { cacheInit } from '@/storage/cache/db'
import { cacheLoadAll, applyRemoteBatch, cacheDeleteAll } from '@/storage/cache/files'
import {
  handleSave, handleLoad, handleClear,
  tokenSave, tokenClear,
  refreshTokenSave, refreshTokenClear,
  tokenExpirySave, tokenExpiryClear,
} from '@/storage/cache/credentials'
import { vaultRefsSave, vaultRefsLoad, activeVaultIdSave, activeVaultIdLoad } from '@/storage/cache/registry'
import { titleToSlug, keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { diskPickDirectory } from './fs'
import { LocalBackend }   from './localBackend'
import { ExampleBackend } from './exampleBackend'
import { ensureFreshAccessToken } from './githubOAuth'
import type { StorageBackend } from './backend'
import type { VaultRef, GitHubVaultRef, IcalVaultRef } from '@/vaultRef'
import {
  getVaults, setStoreState, setVaultLayer, removeVaultLayer,
  setVaultSync, removeVaultSync, getUnreadableFiles, setUnreadableFiles,
  loadGlobalPrefs, loadDefaultParticipants, getDefaultVaultId, setDefaultVaultId, hideVaultOnce,
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
  /**
   * True when at least one *mountable* vault reached phase 2 of
   * `restoreVaultsInner` with nothing painted for it in phase 1 — i.e. its
   * content only lands in the store once its sync completes, after the
   * agenda has already rendered (and seeded its scroll position from)
   * whichever other vaults did have a cache.
   *
   * Distinct from `contentReplaced`: with two registered vaults where only one
   * has a cache, `contentReplaced` is correctly `false` (the pre-painted
   * vault's expansion/section caches must survive), but the *other* vault's
   * rows still arrive later and can land above the agenda's current view —
   * older tasks or events pushing the scroll position back a few seconds
   * after open, since AgendaView's virtualizer only tracks a raw scroll pixel
   * offset. Reported as "opens on today but jumps back in time a few seconds
   * after" once multi-vault made this landing pattern common.
   *
   * Meaningless (and not consulted) when `contentReplaced` is true — that
   * path already re-seeds the scroll position from scratch.
   */
  contentAddedLate: boolean
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

/** Kinds that accept writes — the candidates for `defaultVaultId`. */
function isWritableKind(ref: VaultRef): boolean {
  return ref.kind === 'local' || ref.kind === 'github'
}

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
  setStoreState({ vaults: [EXAMPLE_REF, ...updated] })
  // Favourites and the view filter span every registered vault at once, so the
  // registered set changing is exactly when they must be re-read.
  loadGlobalPrefs([EXAMPLE_REF.id, ...updated.map(r => r.id)])
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
    const token = await ensureFreshAccessToken(ref.id)
    if (!token) return null
    const { GitHubBackend } = await import('./githubBackend')
    return new GitHubBackend(ref.id, ref.name, { ...ref.github, token })
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
 * actively requests permission, which never resolves to `'prompt'`.
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

  const perm = await backend.ensurePermission(interactive)
  // 'unreachable' is emphatically not 'denied': the credential is fine, the
  // network isn't. Mount exactly as for 'granted' — writable, hydrated from
  // cache — so offline edits are recorded as dirty in Dexie and pushed on
  // reconnect. The offline flag and the retry backoff are set by the
  // background sync's own transient classification in runSync, not here, so
  // there stays exactly one writer for that state.
  if (perm === 'granted' || perm === 'unreachable') {
    mountBackend(backend)
    setVaultSync(ref.id, { needsReconnect: false })
    await loadVaultContent(backend, prePainted)
    return perm === 'granted' ? 'granted' : 'offline'
  }
  if (perm === 'prompt' && !interactive) {
    // Mounted, but flagged: the scheduler will attempt it and fail harmlessly
    // until the user clicks through from SyncButton's popover.
    mountBackend(backend)
    setVaultSync(ref.id, { needsReconnect: true })
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
    // The Tutorial vault is synthesized on every load, so without this its
    // sample entries would sit in a real agenda forever. One-time, so
    // un-hiding it in the filter sticks — see `hideVaultOnce`.
    if (wasFirstRealVault) hideVaultOnce(EXAMPLE_REF.id)
    await loadVaultContent(backend)
    emitVaultChanged({ contentReplaced: true, contentAddedLate: false })
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
    const allRefs: VaultRef[] = [EXAMPLE_REF, ...savedRefs]
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
    const mountable = savedRefs.filter(isMountableKind)
    const prePainted = new Map<string, boolean>()
    for (const ref of mountable) {
      prePainted.set(ref.id, await hydrateFromCache(ref.id))
    }
    if ([...prePainted.values()].some(Boolean)) setStoreState({ vaultLoading: false })

    // The Tutorial vault is cache-free and cheap (synthesized in memory), so
    // it is mounted here rather than in either phase's loop.
    await mountExampleVault()

    // Someone upgrading from a single-vault build already has a real vault and
    // has never been offered this choice, so their first launch on the layered
    // store would otherwise drop the tutorial's sample entries into their real
    // agenda. `registerAndMount` covers the other direction (a first vault
    // added later in the session); both are one-time, so un-hiding it in the
    // filter sticks.
    if (mountable.length > 0) hideVaultOnce(EXAMPLE_REF.id)

    // ── Phase 2: credentials, permission, first sync ────────────────
    for (const ref of mountable) {
      try {
        const outcome = await mountVaultRef(ref, false, prePainted.get(ref.id) ?? false)
        if (outcome === 'no-credential') {
          warn(ref.kind === 'local'
            ? `Vault "${ref.name}" is missing its folder permission — remove and re-add it.`
            : `Vault "${ref.name}" is missing its GitHub token — remove and re-add it.`)
        } else if (outcome === 'denied' && ref.kind === 'github') {
          notify(`Could not reconnect GitHub vault "${ref.name}" — check your token.`)
        }
        // An iCal vault only ever answers 'granted' or 'offline'; an
        // unreachable feed leaves its cached events on screen and retries on
        // the next cycle, with no message worth interrupting the user for.
      } catch (e) {
        // One vault's failure must not abort the others' restore.
        console.warn(`[vault] could not mount "${ref.name}":`, e)
      }
    }

    const paintedFlags = [...prePainted.values()]
    emitVaultChanged({
      contentReplaced: !paintedFlags.some(Boolean),
      contentAddedLate: paintedFlags.some(v => !v),
    })
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
        : 'GitHub token not found — try removing and re-adding this vault.')
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
        : `Could not connect to GitHub vault "${ref.name}" — check your token.`)
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

    await tokenSave(id, cfg.accessToken)
    await refreshTokenSave(id, cfg.refreshToken)
    await tokenExpirySave(id, cfg.expiresAt)

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
 */
export async function removeVault(id: string): Promise<void> {
  try {
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
    emitVaultChanged({ contentReplaced: true, contentAddedLate: false })
  } catch (e) {
    console.error('[vault] removeVault failed:', e)
    notifyError('Could not remove vault', e)
  }
}

