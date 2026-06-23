/** Thrown by StorageBackend.write when the CAS precondition fails. */
export class ConflictError extends Error {
  constructor(path: string) {
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
  if (e instanceof TypeError && TRANSIENT_MSG_RE.test((e as Error).message)) return true
  return false
}
