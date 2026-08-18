/**
 * Classifies a thrown error into what should happen next, independent of any
 * particular caller's error-class hierarchy. Pure: no I/O, no octokit import.
 *
 * Rule 1 is load-bearing: a real auth failure always carries an HTTP status
 * from GitHub. An error that never reached GitHub — offline, a dropped
 * connection, a request killed by backgrounding, a captive portal, any of iOS
 * Safari's several network-error wordings — cannot be about credentials, so
 * the *absence* of a status classifies it as transient rather than matching
 * against message text. That is what retires the message-regex whack-a-mole:
 * every device/browser wording is covered by the absence of a status, not by
 * a growing list of strings to match.
 */
export type FailureKind =
  | 'transient' // never reached GitHub, or GitHub is unwell — retry, stay quiet
  | 'auth'      // credentials rejected — refresh, then ask for sign-in
  | 'access'    // the App/user has no access to this repo any more
  | 'config'    // repo or branch renamed/deleted — the vault's settings are wrong
  | 'conflict'  // 409/422 — unchanged, still handled by ConflictError

export interface Failure {
  kind: FailureKind
  status?: number
  message: string
}

function statusOf(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null || !('status' in e)) return undefined
  return typeof e.status === 'number' ? e.status : undefined
}

/**
 * A 403 that still carries rate-limit headers means the throttling plugin's
 * retries were exhausted (or the response leaked past it), not that the
 * request was actually denied — e.g. a burst against a large vault. A 403
 * whose message names a rate limit but arrived without the headers (GitHub's
 * secondary rate limit doesn't always send them) is the same story. Without
 * this check either shape gets misclassified as a bad token, which is what
 * sends users down a fruitless remove-and-re-add-the-vault path instead of
 * just waiting out the limit.
 */
export function isRateLimitError(e: unknown): boolean {
  const headers = (e as { response?: { headers?: Record<string, string> } }).response?.headers
  if (headers && (headers['x-ratelimit-remaining'] === '0' || headers['retry-after'] !== undefined)) return true
  const message = e instanceof Error ? e.message : undefined
  return message !== undefined && /rate limit|secondary|abuse/i.test(message)
}

export function classifyFailure(e: unknown): Failure {
  const status = statusOf(e)
  const message = e instanceof Error ? e.message : String(e)
  if (status === undefined) return { kind: 'transient', message }
  if (status === 401) return { kind: 'auth', status, message }
  if (status === 403) return { kind: isRateLimitError(e) ? 'transient' : 'access', status, message }
  if (status === 404) return { kind: 'config', status, message }
  if (status === 408 || status === 429 || status >= 500) return { kind: 'transient', status, message }
  if (status === 409 || status === 422) return { kind: 'conflict', status, message }
  return { kind: 'transient', status, message }
}
