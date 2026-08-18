import { classifyFailure, type FailureKind } from './failureKind'

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

/**
 * Thrown for auth/access failures that require user action (invalid token,
 * missing repo). `kind` is the `FailureKind` that produced it, narrowed to
 * the three that ever map here — carried so `runSync` can tell "sign in
 * again" apart from "the App lost this repo" apart from "the branch is gone"
 * without re-parsing the message.
 */
export class AuthSyncError extends Error {
  constructor(message: string, readonly kind: Extract<FailureKind, 'auth' | 'access' | 'config'> = 'auth') {
    super(message)
    this.name = 'AuthSyncError'
  }
}

export function isTransientSyncError(e: unknown): boolean {
  if (e instanceof TransientSyncError) return true
  // AuthSyncError and ConflictError are already-classified domain errors that
  // don't carry a top-level `status` (ConflictError's lives under `.detail`).
  // Without this check, classifyFailure's rule 1 ("no status -> transient")
  // would misclassify them via the delegation below — they are never transient.
  if (e instanceof AuthSyncError || e instanceof ConflictError) return false
  // navigator.onLine === false means the browser explicitly reports offline.
  // undefined (e.g. in tests or SSR) means unknown — don't classify.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return classifyFailure(e).kind === 'transient'
}
