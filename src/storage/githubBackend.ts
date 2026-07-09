import type { StorageBackend, RawFile, VaultKind } from './backend'
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
      const results = await Promise.all(
        paths.map(async path => {
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
      )
      return results.filter((r): r is RawFile => r !== null)
    } catch (e) {
      throw mapGitHubError(e)
    }
  }

  async readAll(): Promise<RawFile[]> {
    const tokens = await this.statAll()
    return this.readFiles(Array.from(tokens.keys()))
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
    const sha = this._shas.get(path) ?? expectedVersion
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
