import type { StoreItem, Roots } from './types'
import type { VaultRef } from './storage/backend'
import { useStore } from './store'
import { toast } from 'sonner'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems         = (): StoreItem[]    => useStore.getState().items
export const getRoots         = (): Roots          => useStore.getState().roots
export const setData          = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getVaults        = (): VaultRef[]     => useStore.getState().vaults
export const getActiveVaultId = (): string | null  => useStore.getState().activeVaultId

// ── STORE WRITERS (storage layer uses these instead of useStore directly) ──
export const setSyncDirtyCount   = (n: number)         => useStore.setState({ syncDirtyCount: n })
export const setSyncError        = (error: boolean)    => useStore.setState({ syncError: error })
export const setVaultList        = (refs: VaultRef[])  => useStore.setState({ vaults: refs })
export const setActiveVaultId    = (id: string | null) => useStore.setState({ activeVaultId: id })
export const setPendingReconnect = (name: string | null) => useStore.setState({ pendingDirReconnect: name })

// ── NOTIFICATIONS ──────────────────────────────────────────────
export function notify(msg: string): void {
  toast.error(msg, { duration: 5000 })
}

export function warn(msg: string): void {
  toast.warning(msg, { duration: 7000 })
}
