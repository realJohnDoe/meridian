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
  write(path: string, content: string):   Promise<void>
  delete(path: string):                   Promise<void>
  /** Local: query/request FS permission. Example: always returns 'granted'. */
  ensurePermission(interactive: boolean): Promise<PermissionState>
}
