import type { StoreItem, Roots, VaultRef, Occurrence } from './types'
import { useStore } from './store'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems         = (): StoreItem[]    => useStore.getState().items
export const getRoots         = (): Roots          => useStore.getState().roots
export const getFom           = (): Map<string, Occurrence> => useStore.getState().fom
export const getBacklinks     = (): Map<string, string[]> => useStore.getState().backlinks
export const setData          = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getVaults        = (): VaultRef[]     => useStore.getState().vaults
export const getSyncError     = (): string | null  => useStore.getState().syncError

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
    useStore.getState().loadShowTasks(id)
  } else {
    useStore.setState({ favorites: [], defaultParticipants: [], participantFilter: [], showTasks: true })
  }
}
export const setPendingReconnect = (name: string | null) => useStore.setState({ pendingDirReconnect: name })
