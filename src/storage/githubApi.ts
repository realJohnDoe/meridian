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
      onSecondaryRateLimit: (retryAfter: number, options: { method: string; url: string }) => {
        console.warn(`[github] secondary rate limit hit for ${options.method} ${options.url}; retrying after ${retryAfter}s`)
        return true
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

export function mapGitHubError(e: unknown): Error {
  if (e instanceof Error && 'status' in e) {
    const status = (e as { status: number }).status
    if (status === 401) return new Error('GitHub token is invalid or expired.')
    if (status === 403) return new Error('GitHub access denied or rate limit reached.')
    if (status === 404) return new Error('Repository not found or token lacks access.')
    if (status === 409 || status === 422) return new Error('File changed on GitHub since last sync — reload the vault to continue.')
  }
  return e instanceof Error ? e : new Error(String(e))
}
