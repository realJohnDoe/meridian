import type { StoreItem, Roots } from './types'
import { useStore } from './store'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems    = (): StoreItem[]   => useStore.getState().items
export const getRoots    = (): Roots         => useStore.getState().roots
export const setData     = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getDirHandle  = ()              => useStore.getState().dirHandle
export const setDirHandle  = (h: FileSystemDirectoryHandle | null) => useStore.setState({ dirHandle: h })

// ── NAVIGATION ─────────────────────────────────────────────────
/** Navigate back in browser history (replaces popOverlay after router migration). */
export const navigateBack = () => window.history.back()

// ── ERROR NOTIFICATION ─────────────────────────────────────────
export function notify(msg: string): void {
  useStore.setState({ errorNotification: msg });
  setTimeout(() => {
    if (useStore.getState().errorNotification === msg) {
      useStore.setState({ errorNotification: null });
    }
  }, 5000);
}
