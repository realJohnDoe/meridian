import type { VaultKind } from '@/vaultRef'

/** Whether `name` is a vault entry file (markdown with YAML frontmatter). */
export function isVaultFile(name: string): boolean {
  return name.endsWith('.md')
}

export interface RawFile {
  path:    string
  content: string
  version: string
  /**
   * When the backend last saw this file's bytes change, epoch ms — the
   * retention sweep's age signal (plans/archived-entries.md 4b). Never a
   * heuristic: local FS is `File.lastModified`, "bytes written on this
   * machine"; GitHub is a commit's `committedDate`, "committed to this
   * branch". The two answer different questions (a fresh clone or a
   * Dropbox/Syncthing resync resets every FS mtime to now; a squash-merge
   * does the same on the GitHub side) but both fail *safe* the same way —
   * recent rather than stale — so callers never need to know which backend
   * produced it.
   *
   * Populated by `readAll()` only — a bulk read is where the cost of getting
   * it (an FS stat that's already happening, or GitHub's batched commit-date
   * backfill) is worth paying. `readFiles()` never sets it: an incremental
   * pull already has a cheaper signal for "this changed" (its version token
   * drifted from the cache's), so `reconcileWithBackend` stamps the current
   * time instead of asking the backend for one. `undefined` when the backend
   * doesn't know (or wasn't asked) — the sweep treats that as "never archive"
   * rather than guessing.
   */
  lastModified?: number
}

/**
 * Result of a backend's permission probe. Deliberately a superset of the
 * DOM's `PermissionState`: a network-backed vault has a third possible
 * answer — the backend could not be reached at all, which is neither granted
 * nor denied. Local/example backends do no I/O and keep `PermissionState` as
 * their own return type, which documents that in the signature.
 */
export type PermissionOutcome = PermissionState | 'unreachable'

export interface StorageBackend {
  readonly id:       string
  readonly name:     string
  readonly kind:     VaultKind
  /** Whether writes are pushed. False for the Tutorial vault and for iCal feeds. */
  readonly readOnly: boolean
  /**
   * Whether there is a remote worth reconciling against — i.e. whether this
   * vault takes part in the cache/sync pipeline at all.
   *
   * Deliberately NOT the same question as `readOnly`, and the iCal vault kind is
   * exactly why the two had to be separated. Both the Tutorial vault and a
   * calendar subscription are read-only, but only one of them is a dead end: the
   * Tutorial vault's files are synthesized in memory on every load, so it has no
   * Dexie rows and nothing to poll, while a subscription has a live feed that
   * must be pulled on a schedule. The scheduler keys off this; `readOnly` alone
   * decides only whether `pushDirty` runs.
   */
  readonly hasRemote: boolean
  statAll():                               Promise<Map<string, string>>
  /**
   * Reads the given paths. **A path missing from the result means that path
   * does not exist** — that is the contract, not a best-effort hint, and the
   * one thing this must never do is answer "absent" because it could not find
   * out (#1062). A file that is genuinely gone is omitted; every other failure
   * throws, so a caller deciding something on a path's absence is deciding on
   * a fact, and a caller that merely wants content gets an error it can retry
   * (`isTransientSyncError` and the scheduler's backoff already handle it).
   *
   * Tolerance is still per path, not per batch: one absent file among fifty
   * does not fail the read, which is what an incremental pull against an
   * eventually-consistent listing needs. But a batch that could not be
   * completed is an error rather than a shorter list — a partial answer
   * applied as though it were complete silently drops the paths that never
   * arrived.
   */
  readFiles(paths: string[]):              Promise<RawFile[]>
  /**
   * Reads every file in the vault. `onProgress`, if given, may be called zero
   * or more times as files are read, with the cumulative count read so far —
   * backends that read everything in one shot (local, example) simply never
   * call it.
   */
  readAll(onProgress?: (loaded: number, total: number) => void): Promise<RawFile[]>
  /**
   * Write `content` to `path`. If `expectedVersion` is provided the write is a
   * compare-and-swap: it only succeeds if the backend's current version token
   * matches `expectedVersion`. Throws `ConflictError` when the precondition
   * fails. Returns the new version token, if the backend can determine it.
   */
  write(path: string, content: string, expectedVersion?: string): Promise<string | undefined>
  delete(path: string, expectedVersion?: string): Promise<void>
  /** Local: query/request FS permission. GitHub: probe repo access — may
   *  answer 'unreachable' when the network is down. Example: always
   *  'granted'. */
  ensurePermission(interactive: boolean): Promise<PermissionOutcome>
  /**
   * Attempt to recover from an auth failure (e.g. refresh an expired access
   * token) and swap the new credentials into the backend in place. Returns
   * whether recovery succeeded and the failed operation should be retried.
   * Backends with no such recovery path (local, example) omit this.
   *
   * `false` is a verdict on the credential — recovery is impossible and the
   * original auth error should be surfaced. An implementation that could not
   * *reach* its auth service throws `TransientSyncError` instead, so a blip in
   * the recovery attempt is never mistaken for a dead credential.
   */
  refreshAuth?(): Promise<boolean>
}
