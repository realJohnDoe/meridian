import type { StoreItem, Roots } from './types'
import type { VaultRef } from './storage/backend'
import { useStore } from './store'
import { toast } from 'sonner'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems        = (): StoreItem[]    => useStore.getState().items
export const getRoots        = (): Roots          => useStore.getState().roots
export const setData         = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getVaults       = (): VaultRef[]     => useStore.getState().vaults
export const getActiveVaultId = (): string | null => useStore.getState().activeVaultId

// ── NAVIGATION ─────────────────────────────────────────────────
/** Navigate back in browser history (replaces popOverlay after router migration). */
export const navigateBack = () => window.history.back()

// ── NOTIFICATIONS ──────────────────────────────────────────────
export function notify(msg: string): void {
  toast.error(msg, { duration: 5000 })
}

export function warn(msg: string): void {
  toast.warning(msg, { duration: 7000 })
}
