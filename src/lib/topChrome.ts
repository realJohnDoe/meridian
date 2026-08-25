/**
 * Bottom edge of the app's sticky topbar, in viewport coordinates.
 *
 * Floating panels clamp themselves against the *visual viewport*, which knows
 * nothing about app chrome painted over it. Under the fixed shell that gap was
 * invisible: an anchor lived inside a clipped scroller below the topbar and
 * could never travel up into its band. Under the flow shell the entry route
 * scrolls as a document, so an anchor can pass beneath the topbar — and a panel
 * that tracks it lands on top of the chrome (the panel is `fixed z-50`, the
 * topbar `z-10`).
 *
 * Measured off the live element rather than the `--th` token so the top
 * safe-area inset is included without re-deriving `calc(54px + env(...))` here,
 * and so a route with no topbar correctly reports 0.
 */
export function topChromeBottom(): number {
  if (typeof document === 'undefined') return 0
  const el = document.querySelector('[data-shell-topbar]')
  if (!el) return 0
  return Math.max(0, el.getBoundingClientRect().bottom)
}
