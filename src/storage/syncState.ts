/**
 * The mutable state of every vault's sync loop, and every transition on it.
 *
 * This module exists to settle a question `sync.ts` used to answer by keeping
 * everything in one file: the sync core (`sync.ts`) and the scheduler
 * (`syncScheduler.ts`) both read and write the *same* per-vault record — the
 * core advances `lastAttemptAt`/`lastPullAt` and the retry backoff, the
 * scheduler reads them to decide what runs next and clears the backoff on an
 * explicit user gesture. Exporting the map from either side would have made
 * one of them a de-facto owner of the other's state; instead the map lives
 * here, private, reachable only through `syncStateFor`, and both sides import
 * it. The singleton is unchanged — it just no longer lives inside one of its
 * two consumers.
 *
 * The retry backoff belongs here for the same reason it is three fields of
 * this record rather than a structure of its own: a failure and a success are
 * transitions of a vault's sync state, not decisions about scheduling. What
 * the scheduler owns is when to *ask* — `isDue` and the tick — not what a
 * cycle's outcome does to the record.
 */

/**
 * All of sync's mutable state for **one** vault. PR 0 collected six
 * module-level singletons into this record; now there is one instance per
 * registered vault, so two vaults keep independent backoff, independent
 * debounce timers and independent error dedupe — a GitHub vault whose token
 * expired must not stall a local folder that is syncing fine.
 */
export interface VaultSyncState {
  syncing: boolean
  pushTimer: ReturnType<typeof setTimeout> | null
  /**
   * Set when a push was requested (scheduleAutoPush's timer firing, or an
   * explicit flushPendingPush()) while a sync was already in flight. runSync's
   * early `if (syncing) return` would otherwise silently drop that request —
   * there's no rescheduling on that path today — stranding the write until the
   * next autoSyncTick. Re-armed by the scheduler once the in-flight sync
   * settles (see `runCycle`, which is why `runSync` reports whether it ran).
   */
  pushQueued: boolean
  consecutiveFailures: number
  nextRetryAt: number
  /** Dedupe toasts for actionable (non-transient) errors across silent ticks. */
  lastErrorSig: string | null
  /**
   * When a cycle was last *attempted* for this vault — success or failure.
   * Used only to order `autoSyncTick`'s walk (oldest-attempted first) — the
   * pull interval itself is paced from `lastPullAt` below, not from this.
   */
  lastAttemptAt: number
  /**
   * When a cycle last actually **pulled** — i.e. `reconcileWithBackend` ran,
   * whether because the cycle asked for a pull or a collision forced one.
   * `isDue` measures the per-vault pull interval from here rather than from
   * `lastAttemptAt`, so a push-only cycle (the debounced auto-push from
   * typing) advancing `lastAttemptAt` on every keystroke can no longer make a
   * vault look "recently synced" when it has not actually pulled in minutes —
   * see finding #1, "every push defers the next pull by a full interval".
   * Deliberately a separate field from `lastAttemptAt`, which the retry
   * backoff and the scheduler's ordering still need untouched.
   */
  lastPullAt: number
}

function createVaultSyncState(): VaultSyncState {
  return {
    syncing: false, pushTimer: null, pushQueued: false,
    consecutiveFailures: 0, nextRetryAt: 0, lastErrorSig: null,
    lastAttemptAt: 0, lastPullAt: 0,
  }
}

const _syncStates = new Map<string, VaultSyncState>()

/** This vault's sync state, created on first ask. */
export function syncStateFor(vaultId: string): VaultSyncState {
  let state = _syncStates.get(vaultId)
  if (!state) { state = createVaultSyncState(); _syncStates.set(vaultId, state) }
  return state
}

/** Forget a vault's sync state and cancel its pending debounce. Called on unmount. */
export function dropSyncState(vaultId: string): void {
  const state = _syncStates.get(vaultId)
  if (state?.pushTimer) clearTimeout(state.pushTimer)
  _syncStates.delete(vaultId)
}

/** Drop every vault's sync state. Tests only — production unmounts one at a time. */
export function dropAllSyncState(): void {
  for (const vaultId of [..._syncStates.keys()]) dropSyncState(vaultId)
}

// ── RETRY BACKOFF ─────────────────────────────────────────────────────
const BACKOFF_BASE_MS = 60_000
const BACKOFF_MAX_MS  = 30 * 60_000

/** A cycle succeeded: clear the backoff and the actionable-error dedupe. */
export function noteSyncSuccess(state: VaultSyncState): void {
  state.consecutiveFailures = 0
  state.nextRetryAt         = 0
  state.lastErrorSig        = null
}

/** A cycle failed transiently: hold this vault off for an exponentially longer wait. */
export function noteSyncFailure(state: VaultSyncState): void {
  state.consecutiveFailures++
  state.nextRetryAt = Date.now() + Math.min(
    BACKOFF_BASE_MS * Math.pow(2, state.consecutiveFailures - 1),
    BACKOFF_MAX_MS,
  )
}

/**
 * Let this vault try again right now, leaving the failure streak alone. A
 * deliberate "Sync now" means "try again", not "pretend the previous failures
 * didn't happen" — the next failure should still back off as far as it would
 * have.
 */
export function clearBackoff(vaultId: string): void {
  syncStateFor(vaultId).nextRetryAt = 0
}

/**
 * Forget one vault's failure streak entirely. A fresh activation is a
 * deliberate, user-visible moment and deserves a clean slate rather than the
 * previous session's accumulated wait.
 */
export function resetVaultBackoff(vaultId: string): void {
  const state = syncStateFor(vaultId)
  state.consecutiveFailures = 0
  state.nextRetryAt         = 0
}

/** Clear the retry backoff for every registered vault (e.g. the `online` event). */
export function resetSyncBackoff(): void {
  for (const vaultId of [..._syncStates.keys()]) resetVaultBackoff(vaultId)
}
