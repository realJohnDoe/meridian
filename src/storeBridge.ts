import type { StoreItem, Roots, Occurrence } from './types'
import type { EntryKey } from './fileIO'
import type { VaultRef } from './vaultRef'
import { useStore, vaultLayer } from './store'
import type { VaultLayer, VaultSyncStatus } from './store'
import { fileOccurrenceMap } from './fileOccurrence'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems         = (): StoreItem[]    => useStore.getState().items
export const getRoots         = (): Roots          => useStore.getState().roots
export const getFom           = (): Map<EntryKey, Occurrence> => fileOccurrenceMap(getItems(), getRoots())
export const setData          = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getSnapshot      = (): { items: StoreItem[]; roots: Roots } => ({ items: getItems(), roots: getRoots() })
export const getVaults        = (): VaultRef[]     => useStore.getState().vaults
/** Where a brand-new entry goes unless the editor overrides it per entry. */
export const getDefaultVaultId = (): string | null => useStore.getState().defaultVaultId
export const getUnreadableFiles = (): Map<EntryKey, { path: string; message: string }> => useStore.getState().unreadableFiles
export const setUnreadableFiles = (files: Map<EntryKey, { path: string; message: string }>) => useStore.getState().setUnreadableFiles(files)

// ── LAYERS ─────────────────────────────────────────────────────
/**
 * One registered vault's content, isolated from the merge.
 *
 * `getItems()`/`getRoots()` are the *merged* view across every registered
 * vault, which is what views want and what the domain layer edits against —
 * but two sites in `storage/sync.ts` must see a single vault instead:
 * `mergeChangedIntoStore` (rebuilds one vault's content by filtering out
 * affected keys) and `writeEntityToCache` (collapses one file back to YAML).
 * Reading the merge there would fold every other vault's entries into the
 * layer being written back.
 *
 * Returns an empty layer for an unregistered vault rather than `undefined`,
 * so callers that are only reading never need a null branch.
 */
export const getVaultLayer   = (vaultId: string): VaultLayer =>
  vaultLayer(useStore.getState().layers, vaultId)
export const setVaultLayer   = (vaultId: string, data: VaultLayer): void =>
  useStore.getState().setVaultLayer(vaultId, data)
export const removeVaultLayer = (vaultId: string): void =>
  useStore.getState().removeVaultLayer(vaultId)

// ── PER-VAULT SYNC STATUS ──────────────────────────────────────
export const setVaultSync    = (vaultId: string, patch: Partial<VaultSyncStatus>): void =>
  useStore.getState().setVaultSync(vaultId, patch)
export const removeVaultSync = (vaultId: string): void =>
  useStore.getState().removeVaultSync(vaultId)

// ── STORE WRITERS (storage layer uses these instead of useStore directly) ──
/** Single-field-set forwarder for callers that don't need any fan-out. */
export const setStoreState = useStore.setState

/**
 * Load the preferences that span every registered vault, once at startup and
 * again whenever a vault is added or removed.
 *
 * `hiddenVaultIds`/`hiddenParticipants` decide what the calendar renders (they
 * feed `useCalendarFilter`), so they are not merely cosmetic: whatever is on
 * screen before they land is filtered by the *defaults*. They are a
 * synchronous localStorage read — no credential, no network — so this is
 * called before the first paint rather than after the vaults finish activating.
 *
 * Eager and cross-vault by design: the Favorites list and the filter
 * popover both span every registered vault at once, so
 * neither can wait for a vault to "activate" the way the old per-vault
 * `loadVaultPrefs` did. `defaultParticipants` is the one field still loaded
 * lazily, one vault at a time — see `loadDefaultParticipants`.
 *
 * Idempotent: calling it again is a re-read, not a change.
 */
export const loadGlobalPrefs = (vaultIds: string[]): void => {
  const store = useStore.getState()
  store.loadFavorites(vaultIds)
  store.loadViewFilter()
  store.loadShowTasks(vaultIds)
}

/** Load the one still-lazy per-vault pref: the participants seeded into new entries. */
export const loadDefaultParticipants = (vaultId: string): void =>
  useStore.getState().loadDefaultParticipants(vaultId)

export const setDefaultVaultId = (id: string | null): void =>
  useStore.getState().setDefaultVaultId(id)

/** Follow a favourited entry that changed key — see `moveEntryToVault`. */
export const replaceFavorite = (fromKey: EntryKey, toKey: EntryKey): void =>
  useStore.getState().replaceFavorite(fromKey, toKey)

/** One-time default hide — see `hideVaultOnce`. Used for the Tutorial vault. */
export const hideVaultOnce = (vaultId: string): void =>
  useStore.getState().hideVaultOnce(vaultId)
