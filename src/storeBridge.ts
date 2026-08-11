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
/**
 * Load the per-vault preferences out of localStorage.
 *
 * Two of these — `participantFilter` and `showTasks` — decide what the calendar
 * renders (they feed `useCalendarFilter`), so they are not merely cosmetic:
 * whatever is on screen before they land is filtered by the *defaults*.
 *
 * Split out of `setActiveVaultId` so the cache-first paint can call it before
 * it paints. These are a synchronous localStorage read — no credential, no
 * network — but `setActiveVaultId` only runs after the OAuth token refresh and
 * the permission probe. Painting first and re-filtering afterwards silently
 * removed rows from *above* the agenda's scroll position, sliding it forward by
 * however tall the (now-empty) overdue section had been. See
 * plans/time-to-today.md.
 *
 * Idempotent: calling it again for the same vault is a re-read, not a change.
 */
export const loadVaultPrefs      = (id: string): void => {
  const store = useStore.getState()
  store.loadFavorites(id)
  store.loadDefaultParticipants(id)
  store.loadParticipantFilter(id)
  store.loadShowTasks(id)
}
export const setActiveVaultId    = (id: string | null) => {
  useStore.setState({ activeVaultId: id })
  if (id) {
    loadVaultPrefs(id)
  } else {
    useStore.setState({ favorites: [], defaultParticipants: [], participantFilter: [], showTasks: true })
  }
}
