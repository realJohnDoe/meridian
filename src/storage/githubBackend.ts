import type { StorageBackend, FileEntry, VaultKind } from './backend'
import { makeOctokit, encodeBase64, decodeBase64, mapGitHubError } from './githubApi'

function isVaultFile(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.yaml') || name.endsWith('.yml')
}

interface GitHubConfig {
  owner:  string
  repo:   string
  branch: string
  token:  string
}

type ContentItem = {
  type: string
  name: string
  sha:  string
  path: string
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

  // ── StorageBackend ─────────────────────────────────────────────

  async statAll(): Promise<Map<string, string>> {
    try {
      const { data } = await this._octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: this._cfg.owner,
        repo:  this._cfg.repo,
        path:  '',
        ref:   this._cfg.branch,
      })
      const items = (Array.isArray(data) ? data : [data]) as ContentItem[]
      const tokens = new Map<string, string>()
      for (const item of items) {
        if (item.type !== 'file' || !isVaultFile(item.name)) continue
        tokens.set(item.name, item.sha)
        this._shas.set(item.name, item.sha)
      }
      return tokens
    } catch (e) {
      throw mapGitHubError(e)
    }
  }

  async readFiles(paths: string[]): Promise<FileEntry[]> {
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
      return results.filter((r): r is FileEntry => r !== null)
    } catch (e) {
      throw mapGitHubError(e)
    }
  }

  async readAll(): Promise<FileEntry[]> {
    const tokens = await this.statAll()
    return this.readFiles(Array.from(tokens.keys()))
  }

  async write(path: string, content: string): Promise<string | undefined> {
    try {
      const existingSha = this._shas.get(path)
      const { data } = await this._octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner:   this._cfg.owner,
        repo:    this._cfg.repo,
        path,
        branch:  this._cfg.branch,
        message: `Update ${path}`,
        content: encodeBase64(content),
        ...(existingSha ? { sha: existingSha } : {}),
      })
      // Update SHA from the response so subsequent writes in the same session work
      const newSha = (data as { content?: { sha?: string } }).content?.sha
      if (newSha) this._shas.set(path, newSha)
      return newSha
    } catch (e) {
      throw mapGitHubError(e)
    }
  }

  async delete(path: string): Promise<void> {
    const sha = this._shas.get(path)
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
      throw mapGitHubError(e)
    }
  }

  async ensurePermission(_interactive: boolean): Promise<PermissionState> {
    try {
      await this._octokit.request('GET /repos/{owner}/{repo}', {
        owner: this._cfg.owner,
        repo:  this._cfg.repo,
      })
      return 'granted'
    } catch {
      return 'denied'
    }
  }
}
