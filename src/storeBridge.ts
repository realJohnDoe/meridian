import type { StoreItem, Roots, Occurrence } from './types'
import type { VaultRef } from './vaultRef'
import { useStore } from './store'
import { fileOccurrenceMap } from './fileOccurrence'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems         = (): StoreItem[]    => useStore.getState().items
export const getRoots         = (): Roots          => useStore.getState().roots
export const getFom           = (): Map<string, Occurrence> => fileOccurrenceMap(getItems(), getRoots())
export const setData          = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getSnapshot      = (): { items: StoreItem[]; roots: Roots } => ({ items: getItems(), roots: getRoots() })
export const getVaults        = (): VaultRef[]     => useStore.getState().vaults
export const getSyncError     = (): string | null  => useStore.getState().syncError
export const getUnreadableFiles = (): Map<string, { path: string; message: string }> => useStore.getState().unreadableFiles
export const setUnreadableFiles = (files: Map<string, { path: string; message: string }>) => useStore.getState().setUnreadableFiles(files)

// ── STORE WRITERS (storage layer uses these instead of useStore directly) ──
/** Single-field-set forwarder for callers that don't need `setActiveVaultId`'s fan-out. */
export const setStoreState = useStore.setState
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
