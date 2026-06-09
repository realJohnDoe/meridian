import type { StoreItem, Roots } from './types'
import { useStore } from './store'
import type { PrimaryView, OverlayView } from './store'

// ── STORE ACCESSORS ────────────────────────────────────────────
export const getItems      = (): StoreItem[]   => useStore.getState().items
export const getRoots      = (): Roots         => useStore.getState().roots
export const setData       = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
export const getPrimary    = ()                  => useStore.getState().primaryView
export const setPrimary    = (v: PrimaryView)    => useStore.getState().setPrimaryView(v)
export const pushOverlayFn = (v: OverlayView)    => useStore.getState().pushOverlay(v)
export const popOverlayFn  = ()               => useStore.getState().popOverlay()
export const setCalMonth   = (d: Date)         => useStore.setState({ calMonth: d })
export const setDvDate     = (d: Date)         => useStore.setState({ dvDate: d })
export const getDirHandle  = ()               => useStore.getState().dirHandle
export const setDirHandle  = (h: FileSystemDirectoryHandle | null) => useStore.setState({ dirHandle: h })

// ── ERROR NOTIFICATION ─────────────────────────────────────────
export function notify(msg: string): void {
  useStore.setState({ errorNotification: msg });
  setTimeout(() => {
    if (useStore.getState().errorNotification === msg) {
      useStore.setState({ errorNotification: null });
    }
  }, 5000);
}
