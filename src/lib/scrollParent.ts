/**
 * The nearest ancestor of `el` that is actually scrollable right now — falling
 * back to the document scroller rather than null, because under the entry
 * routes, which have no pane of their own, the *document* is what scrolls, so
 * the walk finds nothing there and a null scroller would silently turn a
 * caller's scroll nudge into a no-op.
 *
 * "Actually scrollable" means both halves: it declares `overflow-y: auto|scroll`
 * *and* is overflowing (`scrollHeight > clientHeight`). Declaring overflow is
 * not enough on its own — the entry routes put a `.flex-1.overflow-y-auto`
 * between their content and the document but never cap the app column's height,
 * so that pane sits at `scrollHeight === clientHeight` and never scrolls a
 * pixel. Matching it would hand callers an element whose scroll offset is
 * permanently 0, and every read and write against it a silent no-op (#850).
 */
export function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    const scrollable = style.overflowY === 'auto' || style.overflowY === 'scroll'
    if (scrollable && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return document.scrollingElement as HTMLElement | null
}
