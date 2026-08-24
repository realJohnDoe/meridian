import { useLayoutEffect } from 'react'

export type ShellMode = 'fixed' | 'flow'

/**
 * Selects which of the two app shells is active, by setting `data-shell` on
 * `<html>` for src/index.css to key off.
 *
 * - `fixed` (default) — the app column is exactly one screen tall and the
 *   document never scrolls; each pane owns an inner scroller. Required by the
 *   calendar routes, whose lists are virtualized: `useVirtualizer` is
 *   element-scoped via `getScrollElement`, and AgendaView's scroll-restore
 *   machinery (computeAgendaScrollRestore/useSaveAgendaScroll) banks offsets
 *   from that element's own scroll events.
 * - `flow` — the document scrolls. Used by the entry routes so that focusing an
 *   input lets the *browser* scroll it above the on-screen keyboard, natively
 *   and on every platform, instead of us reconstructing that from
 *   `visualViewport`. Only safe where no virtualizer is mounted, since a
 *   virtualized row outside the rendered range is not in the DOM for the
 *   browser to scroll to.
 *
 * Layout, not passive: the attribute drives the document's own overflow, so
 * applying it after paint would show one frame of the wrong shell on entry.
 */
export function useShellMode(mode: ShellMode) {
  useLayoutEffect(() => {
    const root = document.documentElement
    if (mode === 'fixed') {
      root.removeAttribute('data-shell')
    } else {
      root.setAttribute('data-shell', mode)
    }
    // Always restore the default on unmount: the flow shell leaves the document
    // scrollable, and a calendar route inheriting that would let the whole app
    // column scroll behind its own panes.
    return () => { root.removeAttribute('data-shell') }
  }, [mode])
}
