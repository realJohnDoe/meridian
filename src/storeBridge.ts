import type { StoreItem, Roots } from './types'
import type { VaultRef } from './storage/backend'
import { useStore } from './store'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems         = (): StoreItem[]    => useStore.getState().items
export const getRoots         = (): Roots          => useStore.getState().roots
export const setData          = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getVaults        = (): VaultRef[]     => useStore.getState().vaults
export const getActiveVaultId = (): string | null  => useStore.getState().activeVaultId

// ── STORE WRITERS (storage layer uses these instead of useStore directly) ──
export const setVaultLoading     = (loading: boolean)  => useStore.setState({ vaultLoading: loading })
export const setSyncDirtyCount   = (n: number)         => useStore.setState({ syncDirtyCount: n })
export const setSyncError        = (error: string | null) => useStore.setState({ syncError: error })
export const setSyncOffline      = (offline: boolean)      => useStore.setState({ syncOffline: offline })
export const setLastSyncedAt     = (ts: number | null)     => useStore.setState({ lastSyncedAt: ts })
export const setVaultList        = (refs: VaultRef[])  => useStore.setState({ vaults: refs })
export const setActiveVaultId    = (id: string | null) => {
  useStore.setState({ activeVaultId: id })
  if (id) {
    useStore.getState().loadFavorites(id)
    useStore.getState().loadDefaultParticipants(id)
    useStore.getState().loadParticipantFilter(id)
  } else {
    useStore.setState({ favorites: [], defaultParticipants: [], participantFilter: [] })
  }
}
export const setPendingReconnect = (name: string | null) => useStore.setState({ pendingDirReconnect: name })
