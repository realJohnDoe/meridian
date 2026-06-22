import type { StoreItem, Roots } from '@/types'
import type { VaultRef } from './backend'

export interface StorageCallbacks {
  getItems: () => StoreItem[]
  getRoots: () => Roots
  getVaults: () => VaultRef[]
  setData: (d: { items: StoreItem[]; roots: Roots }) => void
  setVaultLoading: (loading: boolean) => void
  setSyncDirtyCount: (n: number) => void
  setSyncError: (error: string | null) => void
  setVaultList: (refs: VaultRef[]) => void
  setActiveVaultId: (id: string | null) => void
  setPendingReconnect: (name: string | null) => void
  notify: (msg: string) => void
  warn: (msg: string) => void
  notifyError: (prefix: string, e: unknown) => void
}

let _cb: StorageCallbacks | null = null

export function initStorageCallbacks(cb: StorageCallbacks): void {
  _cb = cb
}

export function getCb(): StorageCallbacks {
  if (!_cb) throw new Error('Storage callbacks not initialised — call initStorageCallbacks first')
  return _cb
}
