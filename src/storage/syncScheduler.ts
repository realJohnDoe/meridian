/**
 * When each vault's sync cycle runs: the debounced push after an edit, the
 * periodic tick, and the two explicit entry points ("Sync now" and the first
 * cycle after a vault activates).
 *
 * Split out of `sync.ts`, which now answers only "what does one cycle do".
 * The two share one mutable record per vault, which is why that record lives
 * in `syncState.ts` rather than in either of them — see the note there.
 *
 * The dependency runs scheduler → core, one-way: nothing in `sync.ts` imports
 * this file. Both things the core once reached back up for — re-arming a push
 * queued mid-cycle, and pushing a vault whose held cross-vault delete just got
 * freed — now come back as fields on `SyncCycleResult` for `runCycle` below to
 * act on.
 */
import type { StorageBackend } from './backend'
import type { VaultKind } from '@/vaultRef'
import { getBackend, getMountedBackends } from './backends'
import { getVaults } from '@/storeBridge'
import { notify } from './notifications'
import { runSync } from './sync'
import { syncStateFor, clearBackoff, resetVaultBackoff } from './syncState'

/**
 * Run one cycle, then do the two things the cycle asked for but could not do
 * itself: push the vaults whose staged move it settled, and drain a push that
 * arrived while it was in flight.
 *
 * Both used to be `sync.ts` calling back into this file — the drain from
 * `runSync`'s own `finally`, the move-release from `releaseMove` — which made
 * the sync core depend on its own scheduler. `runSync` returns the requests as
 * data instead, and this is the one place that acts on them.
 *
 * The drain is gated on `ran` because only the call that owned the vault may
 * take it: a call that bounced off the in-flight guard must leave `pushQueued`
 * for the cycle already running to pick up. `releasedVaults` needs no such
 * gate — a call that did not run returns none.
 */
async function runCycle(backend: StorageBackend, opts: { silent: boolean; pull: boolean }): Promise<void> {
  const { ran, releasedVaults } = await runSync(backend, opts)
  // A settled move frees the *source* vault's held delete, which is usually
  // some other vault than the one this cycle synced — re-read the registry
  // rather than assuming it is still mounted.
  for (const vaultId of releasedVaults) {
    const from = getBackend(vaultId)
    if (from) scheduleAutoPush(from)
  }
  if (!ran) return
  const syncState = syncStateFor(backend.id)
  // A push that arrived mid-sync was queued (see attemptPush) instead of
  // dropped — re-arm the debounced push now that this sync has settled.
  if (syncState.pushQueued) { syncState.pushQueued = false; scheduleAutoPush(backend) }
}

/**
 * Push one vault's pending local changes, or queue the request if its sync is
 * already running.
 *
 * Piggybacks a pull when the vault is already overdue for one (`isDue`) —
 * it's the same round trip the write already pays for. Without this, a vault
 * edited more often than its pull interval (the common case: autosave debounces
 * to a 1s push, well under any pull interval) never reaches the `autoSyncTick`
 * that would otherwise pull it, because every push-only cycle used to advance
 * the same clock the pull interval was paced from. See finding #1.
 */
function attemptPush(backend: StorageBackend): void {
  const syncState = syncStateFor(backend.id)
  if (syncState.syncing) { syncState.pushQueued = true; return }
  void runCycle(backend, { silent: true, pull: isDue(backend, Date.now()) })
}

/** Debounced push for one vault. Exported for `moveEntry.ts`, which writes two vaults at once. */
export function scheduleAutoPush(backend: StorageBackend): void {
  if (backend.readOnly) return
  const syncState = syncStateFor(backend.id)
  if (syncState.pushTimer) clearTimeout(syncState.pushTimer)
  syncState.pushTimer = setTimeout(() => { syncState.pushTimer = null; attemptPush(backend) }, 1000)
}

/**
 * Push anything still dirty right now, in **every** registered vault at
 * once — bypassing the 1s debounce and without waiting for the next
 * autoSyncTick. Both call sites (`routes/__root.tsx`'s `visibilitychange`
 * going hidden, and `pagehide`) fire when the page is about to be
 * backgrounded or torn down, so there is no time left to be polite: unlike
 * `autoSyncTick`, which serializes vaults deliberately (see its doc comment)
 * because nothing else coordinates bursts across vaults' Octokit clients,
 * here a vault skipped or delayed behind another keeps its edit stranded in
 * Dexie until the next launch, which is strictly worse than a burst. If a
 * future caller reaches this from a non-teardown context, it should get its
 * own serial helper instead of reusing this one.
 *
 * Every vault, not just one, for the same reason: `pagehide` is the last
 * moment anything runs. A no-op per vault when nothing is dirty — pushDirty
 * returns immediately if the cache has no dirty/tombstoned records — so this
 * stays cheap.
 */
export function flushPendingPush(): void {
  for (const backend of getMountedBackends()) {
    if (!backend.readOnly) attemptPush(backend)
  }
}

/**
 * The first sync after a vault activates. Replaces the old
 * `reconcileWithBackend(...)` + `flushPendingPush()` pair at the activation
 * site, and is deliberately routed through runSync rather than calling
 * reconcile directly, because runSync is where all four of these live:
 *
 *  - pushDirty runs *before* reconcile and feeds its `pushed` set into
 *    planReconcile's skipPaths — the two used to be independent cycles racing
 *    each other over an eventually-consistent listing;
 *  - transient-vs-actionable classification (isTransientSyncError) and the
 *    retry backoff, so an offline activation degrades instead of throwing;
 *  - setLastSyncedAt — reconcileWithBackend never set it, which is why
 *    SyncButton read "Not synced yet" for 60s after every startup;
 *  - the retry-after-401 forced token refresh.
 *
 * `silent: true`: an offline start must not toast. The backoff is reset
 * first — a fresh activation is a deliberate user-visible moment and deserves
 * an attempt regardless of the previous session's failures.
 *
 * Never rejects (runSync swallows everything in its own catch), so callers can
 * fire-and-forget without risking an unhandled rejection.
 */
export async function syncOnActivate(backend: StorageBackend): Promise<void> {
  resetVaultBackoff(backend.id)
  await runCycle(backend, { silent: true, pull: true })
}
// ── SCHEDULER ─────────────────────────────────────────────────────────

/**
 * How long a vault of each kind waits between automatic cycles.
 *
 * Per kind because the cost of a cycle is not the same for all of them: a
 * local folder's `statAll` is a cheap filesystem walk, a GitHub vault's is a
 * network round trip against a rate-limited API. Unknown kinds (the iCal one
 * lands next) get the conservative default rather than the aggressive one.
 */
const MIN_SYNC_INTERVAL_MS: Partial<Record<VaultKind, number>> = {
  local:  30_000,
  // GitHub's git-trees listing now goes out as a conditional request (see
  // GitHubBackend.statAll's ETag/If-None-Match handling) — an unchanged tree
  // answers 304 and doesn't count against the rate limit, so this can afford
  // to be much closer to the local-folder interval than the old 60s budget
  // that assumed every poll was a full, metered request.
  github: 20_000,
  // A subscription is somebody else's calendar: it changes rarely, the fetch
  // crosses two networks (Meridian's Worker, then the provider), and a
  // conditional request makes most of these cycles a 304 with no body anyway.
  ical:   15 * 60_000,
}
const DEFAULT_MIN_SYNC_INTERVAL_MS = 15 * 60_000

/**
 * The base tick is 60s, so an interval of exactly 60s would be skipped roughly
 * every other tick on timer drift alone. Treat a vault as due slightly early
 * rather than letting it slip to 120s.
 */
const DUE_TOLERANCE_MS = 5_000

/**
 * Whether `backend` is due for a **pull** — measured from `lastPullAt`, not
 * `lastAttemptAt` (see that field's doc comment). Two callers: `autoSyncTick`,
 * to decide whether a vault's periodic full cycle runs at all, and
 * `attemptPush`, to decide whether a debounced push should piggyback a pull
 * it would otherwise have to wait a full interval for.
 */
function isDue(backend: StorageBackend, now: number): boolean {
  const state = syncStateFor(backend.id)
  if (now < state.nextRetryAt) return false
  const elapsed = now - state.lastPullAt
  // A wall clock that jumped backwards (a device correcting its time, a
  // timezone-less NTP step) would otherwise park `lastPullAt` in the future
  // and starve this vault until the clock caught up. Treat it as due instead:
  // one extra cycle costs nothing, a stranded vault costs the user their sync.
  if (elapsed < 0) return true
  const interval = MIN_SYNC_INTERVAL_MS[backend.kind] ?? DEFAULT_MIN_SYNC_INTERVAL_MS
  return elapsed + DUE_TOLERANCE_MS >= interval
}

/** True while a scheduler pass is walking the vaults, so passes never overlap. */
let _tickRunning = false

/**
 * One scheduler pass over every registered vault.
 *
 * **Oldest-synced first, one at a time.** Serial rather than parallel on
 * purpose: each `GitHubBackend` owns its own throttled Octokit client, so
 * nothing coordinates bursts across vaults — the same secondary-rate-limit
 * concern that already makes `reconcileWithBackend` switch to `readAll()`
 * above 50 changed paths. It also keeps mobile wake cost flat as vaults are
 * added: N vaults cost N cycles spread over time, not N simultaneous bursts.
 *
 * Ordering by last attempt means a vault that has been waiting longest goes
 * first, so no vault can be starved by a chattier one ahead of it. Vaults
 * whose own minimum interval hasn't elapsed, and vaults inside their retry
 * backoff, are skipped rather than queued.
 *
 * Re-entrancy: a tick that is still walking (a slow vault mid-cycle when the
 * next 60s interval fires, or a `visibilitychange` landing on top of the
 * timer) returns immediately instead of starting a second interleaved walk.
 */
export function autoSyncTick(): void {
  if (_tickRunning) return
  _tickRunning = true
  void (async () => {
    try {
      const due = getMountedBackends()
        .filter(b => b.hasRemote)
        .sort((a, b) => syncStateFor(a.id).lastAttemptAt - syncStateFor(b.id).lastAttemptAt)
      for (const backend of due) {
        // Re-checked per vault rather than filtered up front: an earlier
        // vault's cycle can take long enough for a later one to fall due, and
        // for the registry to change underneath us.
        if (!getBackend(backend.id)) continue
        if (!isDue(backend, Date.now())) continue
        await runCycle(backend, { silent: true, pull: true })
      }
    } finally {
      _tickRunning = false
    }
  })()
}

/**
 * Manual "Sync now". With a vault id, that vault; without, every registered
 * vault that has a remote — the topbar button speaks for the whole app, the
 * per-vault rows in its popover speak for one.
 *
 * Read-only vaults with a remote are included: "Sync now" on a subscription is
 * "refresh this calendar", which is exactly what the user means by it.
 *
 * Always bypasses the backoff gate: an explicit user gesture is a deliberate
 * "try again now".
 */
export async function syncToBackend(vaultId?: string): Promise<void> {
  const targets = vaultId
    ? [getBackend(vaultId)].filter((b): b is StorageBackend => !!b)
    : getMountedBackends().filter(b => b.hasRemote)

  if (targets.length === 0) {
    if (vaultId) {
      const name = getVaults().find(v => v.id === vaultId)?.name ?? vaultId
      notify(`"${name}" isn't connected — it may still be restoring, or failed to mount.`)
    } else {
      notify('No writable vault connected. Add a local folder first.')
    }
    return
  }
  for (const backend of targets) {
    clearBackoff(backend.id)
    await runCycle(backend, { silent: false, pull: true })
  }
}
