import type { StoreItem, Roots } from './types'
import type { VaultRef } from './storage/backend'
import { useStore } from './store'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems        = (): StoreItem[]    => useStore.getState().items
export const getRoots        = (): Roots          => useStore.getState().roots
export const setData         = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getVaults       = (): VaultRef[]     => useStore.getState().vaults
export const getActiveVaultId = (): string | null => useStore.getState().activeVaultId

// ── ERROR NOTIFICATION ─────────────────────────────────────────
export function notify(msg: string): void {
  useStore.setState({ errorNotification: msg });
  setTimeout(() => {
    if (useStore.getState().errorNotification === msg) {
      useStore.setState({ errorNotification: null });
    }
  }, 5000);
}
