export type VaultKind = 'local' | 'example' | 'github'

export interface FileEntry {
  path:    string
  content: string
  version: string
}

interface VaultRefBase {
  id:   string
  name: string
}

export interface LocalVaultRef extends VaultRefBase {
  kind: 'local'
}

export interface ExampleVaultRef extends VaultRefBase {
  kind: 'example'
}

export interface GitHubVaultRef extends VaultRefBase {
  kind:   'github'
  github: { owner: string; repo: string; branch: string }
}

export type VaultRef = LocalVaultRef | ExampleVaultRef | GitHubVaultRef

export interface StorageBackend {
  readonly id:       string
  readonly name:     string
  readonly kind:     VaultKind
  readonly readOnly: boolean
  statAll():                               Promise<Map<string, string>>
  readFiles(paths: string[]):              Promise<FileEntry[]>
  readAll():                               Promise<FileEntry[]>
  /**
   * Write `content` to `path`. If `expectedVersion` is provided the write is a
   * compare-and-swap: it only succeeds if the backend's current version token
   * matches `expectedVersion`. Throws `ConflictError` when the precondition
   * fails. Returns the new version token, if the backend can determine it.
   */
  write(path: string, content: string, expectedVersion?: string): Promise<string | undefined>
  delete(path: string):                   Promise<void>
  /** Local: query/request FS permission. Example: always returns 'granted'. */
  ensurePermission(interactive: boolean): Promise<PermissionState>
}
