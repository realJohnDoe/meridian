import type { StorageBackend, RawFile } from './backend'
import type { VaultKind } from '@/types'
import { diskStatAll, diskReadFiles, diskReadAll, diskWrite, diskDelete } from './fs'

export class LocalBackend implements StorageBackend {
  readonly kind: VaultKind = 'local'
  readonly readOnly = false

  constructor(
    readonly id:   string,
    readonly name: string,
    private _handle: FileSystemDirectoryHandle,
  ) {}

  get handle(): FileSystemDirectoryHandle { return this._handle }

  statAll():                             Promise<Map<string, string>> { return diskStatAll(this._handle) }
  readFiles(paths: string[]):            Promise<RawFile[]>         { return diskReadFiles(this._handle, paths) }
  readAll():                             Promise<RawFile[]>         { return diskReadAll(this._handle) }
  write(path: string, content: string, expectedVersion?: string): Promise<string | undefined> { return diskWrite(this._handle, path, content, expectedVersion) }
  delete(path: string, _expectedVersion?: string): Promise<void>    { return diskDelete(this._handle, path) }

  async ensurePermission(interactive: boolean): Promise<PermissionState> {
    const perm = await this._handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted' || !interactive) return perm
    return this._handle.requestPermission({ mode: 'readwrite' })
  }
}
