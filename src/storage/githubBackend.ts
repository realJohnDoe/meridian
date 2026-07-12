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
/** Paths per GraphQL batch — stays comfortably under GraphQL query-size/node-cost limits. */
const GRAPHQL_BATCH_SIZE = 100
/** readAll() routes through readFiles() below this size — GraphQL batching only pays off in bulk. */
const GRAPHQL_MIN_FILES = READ_FILES_CONCURRENCY

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

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

/** Escapes a string for embedding in a double-quoted GraphQL string literal. */
function escapeGraphQLString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

type BlobQueryResult = Record<string, { text: string | null } | null>

/** Builds a GraphQL query that fetches the text of many blobs in one request, one per path aliased as f0, f1, … */
function buildBlobQuery(branch: string, paths: string[]): string {
  const fields = paths
    .map((path, i) => `f${i}: object(expression: "${escapeGraphQLString(`${branch}:${path}`)}") { ... on Blob { text } }`)
    .join('\n')
  return `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ${fields}
    }
  }`
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

  async statAll(): Promise<Map<string, string>> {
    try {
      const { data } = await this._octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner:     this._cfg.owner,
        repo:      this._cfg.repo,
        tree_sha:  this._cfg.branch,
        recursive: '1',
      })
      const items = (data as { tree: TreeItem[] }).tree
      const tokens = new Map<string, string>()
      for (const item of items) {
        if (item.type !== 'blob' || !isVaultFile(item.path)) continue
        tokens.set(item.path, item.sha)
        this._shas.set(item.path, item.sha)
      }
      return tokens
    } catch (e) {
      throw mapGitHubError(e)
    }
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
   * Reads every vault file in a handful of requests: one tree listing plus a
   * few GraphQL batches that alias many blobs per request. This avoids the
   * one-Contents-request-per-file fan-out of readFiles(), which trips GitHub's
   * secondary rate limit on vaults with hundreds of files.
   */
  async readAll(): Promise<RawFile[]> {
    const tokens = await this.statAll()
    const paths  = Array.from(tokens.keys())
    if (paths.length === 0) return []
    // Small vaults: a single GraphQL batch wouldn't beat readFiles' own request
    // count by enough to justify the extra code path.
    if (paths.length < GRAPHQL_MIN_FILES) return this.readFiles(paths)

    const files: RawFile[] = []
    const fallbackPaths: string[] = []

    try {
      for (const batch of chunk(paths, GRAPHQL_BATCH_SIZE)) {
        const data = await this._octokit.graphql<{ repository: BlobQueryResult }>(
          buildBlobQuery(this._cfg.branch, batch),
          { owner: this._cfg.owner, name: this._cfg.repo },
        )
        batch.forEach((path, i) => {
          const blob = data.repository[`f${i}`]
          // text is null for binary/oversized blobs, or the alias is absent if the
          // path vanished between the tree listing and this query — either way,
          // fall back to the Contents API for just that file.
          if (blob && blob.text !== null) {
            files.push({ path, content: blob.text, version: tokens.get(path)! })
          } else {
            fallbackPaths.push(path)
          }
        })
      }
    } catch (e) {
      throw mapGitHubError(e)
    }

    if (fallbackPaths.length > 0) {
      files.push(...await this.readFiles(fallbackPaths))
    }

    return files
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
