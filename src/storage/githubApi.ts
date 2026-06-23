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

import { ConflictError, AuthSyncError, TransientSyncError, isTransientSyncError } from './conflictError'

export function mapGitHubError(e: unknown, path?: string): Error {
  if (e instanceof Error && 'status' in e) {
    const status = (e as { status: number }).status
    if (status === 401) return new AuthSyncError('GitHub token is invalid or expired.')
    // 403 can mean rate-limit or permission denied; octokit retries rate limits so a
    // surviving 403 is most likely a permission issue — treat as actionable.
    if (status === 403) return new AuthSyncError('GitHub access denied. Check your token permissions.')
    if (status === 404) return new AuthSyncError('Repository not found or token lacks access.')
    if (status === 409 || status === 422) return new ConflictError(path ?? 'unknown')
  }
  if (isTransientSyncError(e)) return new TransientSyncError((e as Error)?.message)
  return e instanceof Error ? e : new Error(String(e))
}
