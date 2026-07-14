import { unzipSync } from 'fflate'
import type { StorageBackend, RawFile } from './backend'
import type { VaultKind } from '@/types'
import { makeOctokit, encodeBase64, decodeBase64, mapGitHubError } from './githubApi'
import { ensureFreshAccessToken } from './githubOAuth'

function isVaultFile(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.yaml') || name.endsWith('.yml')
}

interface GitHubConfig {
  owner:  string
  repo:   string
  branch: string
  token:  string
}

type TreeItem = {
  type: string
  path: string
  sha:  string
  size?: number
}

type ContentFile = {
  type:    string
  name:    string
  sha:     string
  path:    string
  content: string
}

// ── Bulk read helpers ────────────────────────────────────────────

/** Max concurrent Contents-API requests for readFiles — avoids tripping GitHub's secondary rate limit. */
const READ_FILES_CONCURRENCY = 8
/** readAll() routes through readFiles() below this size — the archive's fetch+unzip overhead only pays off in bulk. */
const ARCHIVE_MIN_FILES = READ_FILES_CONCURRENCY
/** Above this total repo size, skip the archive (avoids pulling a binary-heavy repo's images just to read its text files). */
const ARCHIVE_MAX_BYTES = 20 * 1024 * 1024

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** GitHub archive entries are rooted under an `owner-repo-<sha>/` directory — strip it to get the repo-relative path. */
function stripArchivePrefix(entryName: string): string {
  const i = entryName.indexOf('/')
  return i === -1 ? entryName : entryName.slice(i + 1)
}

export class GitHubBackend implements StorageBackend {
  readonly kind: VaultKind = 'github'
  readonly readOnly        = false

  private _octokit: ReturnType<typeof makeOctokit>
  private _cfg:     GitHubConfig
  /** Blob SHA cache — required by the Contents API for updates and deletes. */
  private _shas = new Map<string, string>()

  constructor(
    readonly id:   string,
    readonly name: string,
    cfg: GitHubConfig,
  ) {
    this._cfg     = cfg
    this._octokit = makeOctokit(cfg.token)
  }

  /** Swaps in a freshly-refreshed access token without recreating the instance. */
  updateToken(token: string): void {
    this._cfg     = { ...this._cfg, token }
    this._octokit = makeOctokit(token)
  }

  async refreshAuth(): Promise<boolean> {
    const fresh = await ensureFreshAccessToken(this.id, { force: true })
    if (!fresh) return false
    this.updateToken(fresh)
    return true
  }

  // ── StorageBackend ─────────────────────────────────────────────

  /**
   * Fetches the recursive tree once and returns both the vault-file path→SHA
   * map (what statAll() exposes) and the total byte size of every blob in the
   * repo (vault files and everything else) — used by readAll() to decide
   * whether an archive download is worth it.
   */
  private async _fetchTree(): Promise<{ tokens: Map<string, string>; totalBytes: number }> {
    try {
      const { data } = await this._octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner:     this._cfg.owner,
        repo:      this._cfg.repo,
        tree_sha:  this._cfg.branch,
        recursive: '1',
      })
      const items = (data as { tree: TreeItem[] }).tree
      const tokens = new Map<string, string>()
      let totalBytes = 0
      for (const item of items) {
        if (item.type !== 'blob') continue
        totalBytes += item.size ?? 0
        if (!isVaultFile(item.path)) continue
        tokens.set(item.path, item.sha)
        this._shas.set(item.path, item.sha)
      }
      return { tokens, totalBytes }
    } catch (e) {
      throw mapGitHubError(e)
    }
  }

  async statAll(): Promise<Map<string, string>> {
    return (await this._fetchTree()).tokens
  }

  async readFiles(paths: string[]): Promise<RawFile[]> {
    try {
      // Bounded concurrency: an unbounded fan-out here reproduces the same
      // secondary-rate-limit burst that readAll() avoids via GraphQL batching —
      // this path is still used for incremental pulls and GraphQL fallback.
      const results = await mapWithConcurrency(paths, READ_FILES_CONCURRENCY, async path => {
        try {
          const { data } = await this._octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner: this._cfg.owner,
            repo:  this._cfg.repo,
            path,
            ref:   this._cfg.branch,
          })
          const file = data as ContentFile
          const content = decodeBase64(file.content)
          this._shas.set(path, file.sha)
          return { path, content, version: file.sha }
        } catch (e) {
          console.warn('[github] could not read', path, e)
          return null
        }
      })
      return results.filter((r): r is RawFile => r !== null)
    } catch (e) {
      throw mapGitHubError(e)
    }
  }

  /**
   * Reads every vault file in two requests — one tree listing plus one repo
   * archive download, unzipped in the browser — instead of the
   * one-Contents-request-per-file fan-out of readFiles(), which trips
   * GitHub's secondary rate limit on vaults with hundreds of files. The
   * archive is bound by total repo bytes rather than file count, so it stays
   * fast even for vaults GraphQL blob-batching (the prior approach) made
   * slow via per-blob server-side latency.
   */
  async readAll(): Promise<RawFile[]> {
    const { tokens, totalBytes } = await this._fetchTree()
    const paths = Array.from(tokens.keys())
    if (paths.length === 0) return []
    // Small vaults: a few parallel Contents requests beat the archive's
    // download+unzip overhead. Huge repos: skip downloading everything
    // (images, etc.) just to read the text files.
    if (paths.length < ARCHIVE_MIN_FILES || totalBytes > ARCHIVE_MAX_BYTES) {
      return this.readFiles(paths)
    }

    // Fetching the archive is a real GitHub API call — auth/permission/network
    // failures here must map and throw exactly like every other method on this
    // class (in particular, an AuthSyncError needs to propagate so runSync's
    // refreshAuth-and-retry logic in sync.ts can act on it). Only the local
    // unzip step below is treated as "this approach didn't work, fall back".
    let archiveBytes: ArrayBuffer
    try {
      const { data } = await this._octokit.request('GET /repos/{owner}/{repo}/zipball/{ref}', {
        owner: this._cfg.owner,
        repo:  this._cfg.repo,
        ref:   this._cfg.branch,
      })
      archiveBytes = data as ArrayBuffer
    } catch (e) {
      throw mapGitHubError(e)
    }

    try {
      const entries = unzipSync(new Uint8Array(archiveBytes), {
        filter: entry => isVaultFile(stripArchivePrefix(entry.name)),
      })

      const files: RawFile[] = []
      const seen = new Set<string>()
      for (const [entryName, bytes] of Object.entries(entries)) {
        const path = stripArchivePrefix(entryName)
        const version = tokens.get(path)
        if (version === undefined) continue // not a tracked vault path (or directory entry)
        files.push({ path, content: new TextDecoder().decode(bytes), version })
        seen.add(path)
      }

      // Paths the tree listed but the archive didn't contain (rare tree/archive
      // drift) — resolve individually rather than silently dropping them.
      const missing = paths.filter(p => !seen.has(p))
      if (missing.length > 0) files.push(...await this.readFiles(missing))

      return files
    } catch (e) {
      // A corrupt/unparseable archive shouldn't break loading — fall back to
      // the per-file path, which is already bounded by READ_FILES_CONCURRENCY.
      console.warn('[github] archive unzip failed, falling back to readFiles', e)
      return this.readFiles(paths)
    }
  }

  async write(path: string, content: string, expectedVersion?: string): Promise<string | undefined> {
    try {
      // Use the caller-supplied expectedVersion as the CAS SHA.
      // Avoid falling back to _shas here — that cache may be stale from a
      // prior statAll() call, which is eventually-consistent on GitHub.
      const { data } = await this._octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner:   this._cfg.owner,
        repo:    this._cfg.repo,
        path,
        branch:  this._cfg.branch,
        message: `Update ${path}`,
        content: encodeBase64(content),
        ...(expectedVersion ? { sha: expectedVersion } : {}),
      })
      // Update SHA from the response so delete() still works in the same session.
      const newSha = (data as { content?: { sha?: string } }).content?.sha
      if (newSha) this._shas.set(path, newSha)
      return newSha
    } catch (e) {
      throw mapGitHubError(e, path)
    }
  }

  async delete(path: string, expectedVersion?: string): Promise<void> {
    // Prefer the caller-supplied expectedVersion as the CAS SHA, matching
    // write()'s policy — avoid falling back to _shas first here, since that
    // cache may be stale from a prior statAll() call and could mask a genuine
    // remote edit that happened after the tombstone was staged.
    const sha = expectedVersion ?? this._shas.get(path)
    if (!sha) return // File doesn't exist on GitHub; nothing to do
    try {
      await this._octokit.request('DELETE /repos/{owner}/{repo}/contents/{path}', {
        owner:   this._cfg.owner,
        repo:    this._cfg.repo,
        path,
        branch:  this._cfg.branch,
        message: `Delete ${path}`,
        sha,
      })
      this._shas.delete(path)
    } catch (e) {
      // Idempotent delete: a 404 means the file is already gone on GitHub —
      // the desired end state. Treat it as success so a stale tombstone (e.g.
      // the delete landed on a prior sync but its cache eviction didn't) can be
      // cleared instead of wedging sync in a permanent retry loop.
      if (e instanceof Error && 'status' in e && (e as { status: number }).status === 404) {
        this._shas.delete(path)
        return
      }
      throw mapGitHubError(e)
    }
  }

  async ensurePermission(_interactive: boolean): Promise<PermissionState> {
    try {
      const { data } = await this._octokit.request('GET /repos/{owner}/{repo}', {
        owner: this._cfg.owner,
        repo:  this._cfg.repo,
      })
      // permissions is only present for authenticated requests; absent means read-only or public token
      if (!data.permissions?.push) return 'denied'
      // Verify the configured branch exists so a wrong-branch config fails early
      await this._octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner:  this._cfg.owner,
        repo:   this._cfg.repo,
        branch: this._cfg.branch,
      })
      return 'granted'
    } catch {
      return 'denied'
    }
  }
}
