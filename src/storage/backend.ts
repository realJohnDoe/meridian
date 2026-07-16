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
  /**
   * Reads every file in the vault. `onProgress`, if given, may be called zero
   * or more times as files are read, with the cumulative count read so far —
   * backends that read everything in one shot (local, example) simply never
   * call it.
   */
  readAll(onProgress?: (loaded: number, total: number) => void): Promise<RawFile[]>
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
  /**
   * Attempt to recover from an auth failure (e.g. refresh an expired access
   * token) and swap the new credentials into the backend in place. Returns
   * whether recovery succeeded and the failed operation should be retried.
   * Backends with no such recovery path (local, example) omit this.
   */
  refreshAuth?(): Promise<boolean>
}
