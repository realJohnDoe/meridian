/**
 * Why a backend refused a write. Carried on `ConflictError` so the resolution
 * path can record *which* refusal it was rather than flattening every cause
 * into one message: GitHub answers 409 both for a genuine SHA mismatch and for
 * a branch-ref race between two commits pushed seconds apart, and 422 for "no
 * sha supplied for an existing file" — three very different stories that look
 * identical once the status is dropped.
 */
export interface ConflictDetail {
  /** HTTP status, for backends that have one. */
  status?: number
  /** The backend's own message, trimmed to something pasteable. */
  reason?: string
}

/** Thrown by StorageBackend.write when the CAS precondition fails. */
export class ConflictError extends Error {
  constructor(readonly path: string, readonly detail?: ConflictDetail) {
    super(`Conflict on ${path}: backend version diverged since last sync.`)
    this.name = 'ConflictError'
  }
}

/** Thrown for network/offline failures — transient, self-healing, should not alert the user. */
export class TransientSyncError extends Error {
  constructor(cause?: string) {
    super(cause ?? 'Network unavailable')
    this.name = 'TransientSyncError'
  }
}

/** Thrown for auth/access failures that require user action (invalid token, missing repo). */
export class AuthSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthSyncError'
  }
}

const TRANSIENT_MSG_RE = /failed to fetch|networkerror|load failed|network request failed/i

export function isTransientSyncError(e: unknown): boolean {
  if (e instanceof TransientSyncError) return true
  // navigator.onLine === false means the browser explicitly reports offline.
  // undefined (e.g. in tests or SSR) means unknown — don't classify.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  // Octokit wraps browser TypeErrors in its own RequestError, so check the
  // message pattern on any Error rather than requiring instanceof TypeError.
  if (e instanceof Error && TRANSIENT_MSG_RE.test(e.message)) return true
  return false
}
