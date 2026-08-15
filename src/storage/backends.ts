import type { StorageBackend } from './backend'

/**
 * The mounted backends, keyed by vault id.
 *
 * Replaces the single `activeBackend` slot. "Mounted" and "registered" are the
 * same thing under the multi-vault model:
 * every vault in `store.vaults` that could build a backend has one here, is
 * loaded into its own store layer, and is kept in sync. There is deliberately
 * no "active" entry — which vault a *new* entry goes to is `defaultVaultId` in
 * the store, and which vaults are *shown* is the view filter. Neither is a
 * property of the backend registry.
 *
 * Insertion order is preserved (plain `Map`), which the sync scheduler relies
 * on only as a tiebreak — it orders by last-synced-at first.
 */
const _backends = new Map<string, StorageBackend>()

export function mountBackend(backend: StorageBackend): void {
  _backends.set(backend.id, backend)
}

export function unmountBackend(vaultId: string): void {
  _backends.delete(vaultId)
}

export function getBackend(vaultId: string): StorageBackend | undefined {
  return _backends.get(vaultId)
}

export function getMountedBackends(): StorageBackend[] {
  return [..._backends.values()]
}

export function getMountedVaultIds(): string[] {
  return [..._backends.keys()]
}

/** Drop every mounted backend. Tests only — production unmounts one at a time. */
export function unmountAllBackends(): void {
  _backends.clear()
}
