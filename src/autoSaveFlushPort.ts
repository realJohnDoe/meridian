/**
 * The open entry editor's pending-autosave flush, if any editor is mounted —
 * registered by `useAutoSave` so `__root.tsx` can commit a still-pending
 * debounced body edit at page teardown, ahead of `flushPendingPush` pushing
 * the cache to the backend (data-integrity survey, finding #7).
 *
 * Not a second `pagehide`/`visibilitychange` listener registered from the
 * editor: `__root`'s own listener is already registered first (it mounts with
 * the app shell), so a listener added later by the editor would always fire
 * *after* it — DOM listeners for the same event on the same target run in
 * registration order. Routing the flush through this port instead lets
 * `__root`'s existing handler call it before `flushPendingPush`, in one
 * function body, with no dependence on registration order.
 *
 * Only one entry editor is ever mounted at a time (each entry has its own
 * route), so "whichever flush is currently registered" is unambiguous.
 */
let flush: (() => void) | null = null

export function registerAutoSaveFlush(fn: (() => void) | null): void {
  flush = fn
}

export function flushActiveAutoSave(): void {
  flush?.()
}
