import type { StorageBackend, RawFile, PermissionOutcome } from './backend'
import { isVaultFile } from './backend'
import type { VaultKind } from '@/vaultRef'
import { makeOctokit, encodeBase64, decodeBase64, mapGitHubError } from './githubApi'
import { ensureFreshAccessToken } from './githubOAuth'
import { isTransientSyncError, TransientSyncError } from './conflictError'
import { journal } from './syncJournal'

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
/**
 * Paths per GraphQL batch. `@octokit/plugin-throttling` hard-codes every
 * GraphQL POST through a "write" Bottleneck group (maxConcurrent: 1,
 * minTime: 1000ms — see its dist-bundle/index.js) — so batches can never
 * actually dispatch concurrently; only one goes out on the wire per second,
 * no matter how many we queue client-side. That makes the real lever for
 * wall-clock time the number of batches, not their concurrency: fewer,
 * larger batches mean fewer 1s dispatch gaps, at the cost of a slower last
 * batch (server time per query is superlinear in blob count — measured
 * ~1.4s for 50 blobs, ~5s for 100). ~50 balances the two.
 */
const GRAPHQL_BATCH_SIZE = 50
/**
 * Max in-flight batch dispatches from our own pool. This does NOT achieve
 * true network concurrency for GraphQL — see GRAPHQL_BATCH_SIZE above, the
 * throttling plugin's internal gate paces actual dispatch to ~1/sec
 * regardless. What this still buys us: batches are queued for dispatch
 * back-to-back rather than one full round-trip apart (the old `for` loop
 * awaited each batch's full response before starting the next), so a
 * batch's server-processing time can overlap with the next batch's 1s
 * dispatch wait instead of adding to it serially. Set to exceed any
 * realistic batch count so our pool is never the bottleneck below what the
 * plugin's own gate already allows through.
 */
const GRAPHQL_CONCURRENCY = 10
/** readAll() routes through readFiles() below this size — GraphQL batching only pays off in bulk. */
const GRAPHQL_MIN_FILES = READ_FILES_CONCURRENCY
/**
 * Paths per commit-date GraphQL batch (plans/archived-entries.md 4b's
 * `lastModified` backfill). Deliberately its own, smaller constant rather
 * than reusing `GRAPHQL_BATCH_SIZE`: that number was measured against
 * `buildBlobQuery`, which reads a blob straight off the tree, while
 * `history(path: ...)` walks a per-path commit log — real work on GitHub's
 * side, not a lookup — so it is heavier per aliased field at the same batch
 * size. Chosen conservatively pending a measurement against a real large
 * repo, the way `GRAPHQL_BATCH_SIZE`'s 50 was.
 */
const HISTORY_BATCH_SIZE = 20

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
      results[i] = await fn(items[i]!)  // i < items.length, checked by the loop
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

type HistoryQueryResult = {
  repository: {
    ref: { target: Record<string, { nodes: { committedDate: string }[] } | null> | null } | null
  }
}

/**
 * Builds a GraphQL query that fetches each path's most recent commit date in
 * one request, one `history` field per path aliased as f0, f1, … — same
 * aliasing shape as `buildBlobQuery`, but every alias shares one `ref`/
 * `target` lookup (the branch is constant across the batch; only `path`
 * varies) rather than each carrying its own `object(expression: ...)`.
 */
function buildHistoryQuery(branch: string, paths: string[]): string {
  const fields = paths
    .map((path, i) => `f${i}: history(first: 1, path: "${escapeGraphQLString(path)}") { nodes { committedDate } }`)
    .join('\n')
  return `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: "refs/heads/${escapeGraphQLString(branch)}") {
        target {
          ... on Commit {
            ${fields}
          }
        }
      }
    }
  }`
}

export class GitHubBackend implements StorageBackend {
  readonly kind: VaultKind = 'github'
  readonly readOnly        = false
  readonly hasRemote       = true

  private _octokit: ReturnType<typeof makeOctokit>
  private _cfg:     GitHubConfig
  /** Blob SHA cache — required by the Contents API for updates and deletes. */
  private _shas = new Map<string, string>()
  /**
   * The ETag from the last successful (non-304) tree listing, and the tokens
   * it produced. `statAll` sends the ETag as `If-None-Match`; GitHub answers
   * 304 with no body when the tree hasn't changed, and — unlike a normal
   * 200 — that response doesn't count against the rate limit, which is the
   * whole point of sending it (see finding #1). On a 304 there is nothing to
   * re-derive tokens from, so the previous listing is returned as-is.
   */
  private _treeEtag:   string | undefined
  private _treeTokens: Map<string, string> | undefined

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
    const result = await ensureFreshAccessToken(this.id, { force: true })
    if (result.status === 'ok') {
      this.updateToken(result.token)
      return true
    }
    // The refresh POST never got an answer — the network dropped, or the
    // Worker/Cloudflare hiccuped. The credential is not implicated, so this
    // must not surface as the 401 that triggered it: rethrowing as transient
    // keeps sync on its backoff instead of telling the user to sign in again
    // over a blip they had nothing to do with.
    if (result.status === 'transient') throw new TransientSyncError('Could not reach GitHub to refresh sign-in.')
    return false
  }

  // ── StorageBackend ─────────────────────────────────────────────

  async statAll(): Promise<Map<string, string>> {
    try {
      const { data, headers } = await this._octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner:     this._cfg.owner,
        repo:      this._cfg.repo,
        tree_sha:  this._cfg.branch,
        recursive: '1',
        ...(this._treeEtag ? { headers: { 'if-none-match': this._treeEtag } } : {}),
      })
      const { tree: items, truncated } = data as { tree: TreeItem[]; truncated?: boolean }
      // A truncated tree silently omits paths past the API's size/entry limit,
      // which would make statAll() look like every omitted file was deleted —
      // reconcile would then evict them from the cache and the store. Refuse
      // instead of acting on a listing known to be incomplete.
      if (truncated) throw new Error('Repository tree listing was truncated — skipping sync to avoid mass deletion.')
      const tokens = new Map<string, string>()
      for (const item of items) {
        if (item.type !== 'blob' || !isVaultFile(item.path)) continue
        tokens.set(item.path, item.sha)
        this._shas.set(item.path, item.sha)
      }
      this._treeEtag   = headers.etag
      this._treeTokens = tokens
      return tokens
    } catch (e) {
      // 304: the tree hasn't changed since the ETag above was recorded — return
      // the same tokens as last time rather than treating "nothing changed" as
      // an error. Only trusted when we actually have a prior listing to fall
      // back to (we always do, since a 304 requires having sent an ETag from
      // one), so the `undefined` case can only be a genuine failure.
      if ((e as { status?: number }).status === 304 && this._treeTokens) return this._treeTokens
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
   * pool of GraphQL batches, each aliasing many blobs per request. Avoids the
   * one-Contents-request-per-file fan-out of readFiles(), which trips
   * GitHub's secondary rate limit on vaults with hundreds of files.
   *
   * Batches are dispatched from a pool (see GRAPHQL_CONCURRENCY) rather than
   * one full round-trip apart, so each batch's server-processing time can
   * overlap with the next batch's dispatch — see GRAPHQL_BATCH_SIZE for why
   * this isn't true network parallelism.
   *
   * `onProgress`, if given, is called after each batch resolves with the
   * cumulative number of files processed so far (including any that fall
   * back to the Contents API) — lets callers show connect progress on a
   * first load. Not called again for the (rare) Contents-API fallback leg.
   */
  async readAll(onProgress?: (loaded: number, total: number) => void): Promise<RawFile[]> {
    const tokens = await this.statAll()
    const paths  = Array.from(tokens.keys())
    const total  = paths.length
    if (total === 0) return []
    // Small vaults: a single GraphQL batch wouldn't beat readFiles' own request
    // count by enough to justify the extra code path. Still backfilled below —
    // readFiles() itself never sets lastModified (see its RawFile doc comment),
    // but readAll() always does, small vault or not.
    if (total < GRAPHQL_MIN_FILES) return this.backfillLastModified(await this.readFiles(paths))

    const files: RawFile[] = []
    const fallbackPaths: string[] = []
    let loaded = 0

    try {
      await mapWithConcurrency(chunk(paths, GRAPHQL_BATCH_SIZE), GRAPHQL_CONCURRENCY, async batch => {
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
        loaded += batch.length
        onProgress?.(loaded, total)
      })
    } catch (e) {
      throw mapGitHubError(e)
    }

    if (fallbackPaths.length > 0) {
      files.push(...await this.readFiles(fallbackPaths))
    }

    return this.backfillLastModified(files)
  }

  /**
   * Attach each file's most recent commit date as `lastModified` — the
   * retention sweep's age signal (plans/archived-entries.md 4b). Blobs carry
   * no dates of their own, so this is a second pass of batched, aliased
   * GraphQL queries (see `buildHistoryQuery`) after the content is already in
   * hand — done here, once, on `readAll()` only: an incremental pull
   * (`readFiles()`) has no call to this at all, and stamps the current time
   * instead (see `reconcileWithBackend`) rather than paying for a
   * history lookup on every ordinary sync.
   *
   * Soft-fails: a lookup that errors (or a path with no history — shouldn't
   * happen, but `nodes` can come back empty) leaves that file's
   * `lastModified` unset rather than failing the whole read. The content is
   * what matters; the age signal degrades to "unknown", which the sweep
   * already treats as "never archive" — fails safe, same as everywhere else
   * in 4b.
   */
  private async backfillLastModified(files: RawFile[]): Promise<RawFile[]> {
    if (files.length === 0) return files
    const dates = new Map<string, number>()
    try {
      await mapWithConcurrency(chunk(files.map(f => f.path), HISTORY_BATCH_SIZE), GRAPHQL_CONCURRENCY, async batch => {
        const data = await this._octokit.graphql<HistoryQueryResult>(
          buildHistoryQuery(this._cfg.branch, batch),
          { owner: this._cfg.owner, name: this._cfg.repo },
        )
        const target = data.repository.ref?.target
        batch.forEach((path, i) => {
          const committedDate = target?.[`f${i}`]?.nodes[0]?.committedDate
          if (committedDate) dates.set(path, new Date(committedDate).getTime())
        })
      })
    } catch (e) {
      console.warn('[github] could not backfill lastModified:', e)
      return files
    }
    return files.map(f => ({ ...f, lastModified: dates.get(f.path) }))
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
    // write()'s policy — never fall back to _shas here, since that cache may
    // be stale from a prior statAll() call and could mask a genuine remote
    // edit that happened after the tombstone was staged.
    let sha = expectedVersion
    if (!sha) {
      // No base version to CAS against — a file created and deleted locally
      // before it ever synced, or a tombstone whose version was lost. Re-read
      // the current state instead of trusting the stale cache, narrowing the
      // race window to the gap between this read and the delete call below
      // (which the CAS delete itself still guards against a conflict).
      const [fresh] = await this.readFiles([path])
      journal('delete-reread', this.id, path, { actual: fresh?.version }, this.kind)
      sha = fresh?.version
      if (!sha) return // File genuinely doesn't exist on GitHub; nothing to do
    }
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
      throw mapGitHubError(e, path)
    }
  }

  async ensurePermission(_interactive: boolean): Promise<PermissionOutcome> {
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
    } catch (e) {
      // Route through the same classifier every other GitHub call already
      // uses (statAll/readFiles/write all `throw mapGitHubError(e)`), so an
      // offline "Failed to fetch" or a rate-limited 403 is never reported as
      // a bad token. A blanket 'denied' here is what sent offline users down
      // the remove-and-re-add-the-vault path.
      return isTransientSyncError(mapGitHubError(e)) ? 'unreachable' : 'denied'
    }
  }
}
