import { Octokit } from '@octokit/core'
import { throttling } from '@octokit/plugin-throttling'

// ── Octokit setup ──────────────────────────────────────────────

const ThrottledOctokit = Octokit.plugin(throttling)

export function makeOctokit(token: string): InstanceType<typeof ThrottledOctokit> {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      // Bottleneck's write group enforces minTime: 1000ms. Under test the
      // transport is a stubbed fetch, so that is a second of real sleep
      // per request with nothing to rate-limit.
      enabled: !import.meta.env.VITEST,
      onRateLimit: (retryAfter: number, options: { method: string; url: string }, _octokit: unknown, retryCount: number) => {
        console.warn(`[github] rate limit hit for ${options.method} ${options.url}; retrying after ${retryAfter}s (attempt ${retryCount + 1})`)
        return retryCount < 2
      },
      onSecondaryRateLimit: (retryAfter: number, options: { method: string; url: string }, _octokit: unknown, retryCount: number) => {
        console.warn(`[github] secondary rate limit hit for ${options.method} ${options.url}; retrying after ${retryAfter}s (attempt ${retryCount + 1})`)
        return retryCount < 2
      },
    },
  })
}

// ── Base64 UTF-8 helpers ───────────────────────────────────────

/** Encode a UTF-8 string to base64 (safe for non-ASCII). */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Decode a base64 string (possibly with newlines) to UTF-8. */
export function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// ── Blob SHAs ──────────────────────────────────────────────────

/**
 * The git blob SHA GitHub will hold for `content` — the same token its
 * Contents API reports as `sha` and accepts as a CAS precondition.
 *
 * Not a fingerprint of our own invention: git hashes a blob as
 * `sha1("blob " + <byte length> + "\0" + bytes)`, and the Contents API commits
 * the bytes it was handed, so this is computable before the write goes out and
 * equal to what comes back after it. That is what makes it usable as a version
 * token for a write whose response never arrived (`GitHubBackend.write`).
 *
 * The length is in **UTF-8 bytes**, not UTF-16 code units — one umlaut in a
 * note is the difference between this matching GitHub and never matching it
 * again, which is why `write` cross-checks the two whenever it has both.
 */
export async function blobSha(content: string): Promise<string> {
  const bytes  = new TextEncoder().encode(content)
  const header = new TextEncoder().encode(`blob ${bytes.length}\u0000`)
  const framed = new Uint8Array(header.length + bytes.length)
  framed.set(header)
  framed.set(bytes, header.length)
  const digest = await crypto.subtle.digest('SHA-1', framed)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Error mapping ──────────────────────────────────────────────

import { ConflictError, AuthSyncError, TransientSyncError } from './conflictError'
import { classifyFailure } from './failureKind'

/** GitHub's own error text, capped so a journal line stays one line. */
function gitHubMessage(e: unknown): string | undefined {
  const msg = (e as { message?: string }).message
  return msg ? msg.slice(0, 200) : undefined
}

export function mapGitHubError(e: unknown, path?: string): Error {
  const failure = classifyFailure(e)
  if (failure.kind === 'auth') return new AuthSyncError("Meridian's access to GitHub expired — sign in again.", 'auth')
  if (failure.kind === 'access') return new AuthSyncError('Meridian no longer has write access — check the App\'s repository access on GitHub.', 'access')
  if (failure.kind === 'config') return new AuthSyncError("That repository or branch isn't reachable — it may have been renamed, deleted, or removed from the App.", 'config')
  // Both statuses reach here for genuinely different reasons — a 409 is
  // either a SHA mismatch or GitHub failing to fast-forward the branch ref
  // behind a commit we ourselves pushed moments earlier, and a 422 is a
  // validation error ("sha wasn't supplied" for a path that exists). Keep the
  // status and GitHub's own message on the error: the resolution path uses
  // them to tell a real divergence from a spurious refusal, and the sync
  // journal records them either way.
  if (failure.kind === 'conflict') {
    return new ConflictError(path ?? 'unknown', { status: failure.status, reason: gitHubMessage(e) })
  }
  return e instanceof TransientSyncError ? e : new TransientSyncError(failure.message)
}
