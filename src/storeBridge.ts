import type { StoreItem, Roots, Occurrence } from './types'
import type { VaultRef } from './vaultRef'
import { useStore } from './store'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems         = (): StoreItem[]    => useStore.getState().items
export const getRoots         = (): Roots          => useStore.getState().roots
export const getFom           = (): Map<string, Occurrence> => useStore.getState().fom
export const setData          = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getSnapshot      = (): { items: StoreItem[]; roots: Roots } => ({ items: getItems(), roots: getRoots() })
export const getVaults        = (): VaultRef[]     => useStore.getState().vaults
export const getSyncError     = (): string | null  => useStore.getState().syncError
export const getUnreadableFiles = (): Map<string, { path: string; message: string }> => useStore.getState().unreadableFiles
export const setUnreadableFiles = (files: Map<string, { path: string; message: string }>) => useStore.getState().setUnreadableFiles(files)

// ── STORE WRITERS (storage layer uses these instead of useStore directly) ──
export const setVaultLoading     = (loading: boolean)  => useStore.setState({ vaultLoading: loading })
export const setVaultLoadProgress = (progress: { loaded: number; total: number } | null) =>
  useStore.setState({ vaultLoadProgress: progress })
export const setSyncDirtyCount   = (n: number)         => useStore.setState({ syncDirtyCount: n })
export const setSyncError        = (error: string | null) => useStore.setState({ syncError: error })
export const setSyncOffline      = (offline: boolean)      => useStore.setState({ syncOffline: offline })
export const setSyncInProgress   = (running: boolean)      => useStore.setState({ syncInProgress: running })
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
