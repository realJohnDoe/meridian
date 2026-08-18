import { Octokit } from '@octokit/core'
import { throttling } from '@octokit/plugin-throttling'

// ── Octokit setup ──────────────────────────────────────────────

const ThrottledOctokit = Octokit.plugin(throttling)

export function makeOctokit(token: string): InstanceType<typeof ThrottledOctokit> {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
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
  if (failure.kind === 'auth') return new AuthSyncError('GitHub token is invalid or expired.')
  if (failure.kind === 'access') return new AuthSyncError('GitHub access denied. Check your token permissions.')
  if (failure.kind === 'config') return new AuthSyncError('Repository not found or token lacks access.')
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
