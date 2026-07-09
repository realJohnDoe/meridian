import type { VaultKind } from '@/types'

export interface RawFile {
  path:    string
  content: string
  version: string
}

export interface StorageBackend {
  readonly id:       string
  readonly name:     string
  readonly kind:     VaultKind
  readonly readOnly: boolean
  statAll():                               Promise<Map<string, string>>
  readFiles(paths: string[]):              Promise<RawFile[]>
  readAll():                               Promise<RawFile[]>
  /**
   * Write `content` to `path`. If `expectedVersion` is provided the write is a
   * compare-and-swap: it only succeeds if the backend's current version token
   * matches `expectedVersion`. Throws `ConflictError` when the precondition
   * fails. Returns the new version token, if the backend can determine it.
   */
  write(path: string, content: string, expectedVersion?: string): Promise<string | undefined>
  delete(path: string, expectedVersion?: string): Promise<void>
  /** Local: query/request FS permission. Example: always returns 'granted'. */
  ensurePermission(interactive: boolean): Promise<PermissionState>
}
