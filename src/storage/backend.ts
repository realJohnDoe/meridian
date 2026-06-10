export type VaultKind = 'local' | 'example'

export interface FileEntry {
  path:    string
  content: string
  version: string
}

export interface VaultRef {
  id:   string
  name: string
  kind: VaultKind
}

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
