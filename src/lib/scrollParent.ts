/**
 * Walks up from `el` to find the nearest scrollable ancestor, falling back to
 * the document scroller rather than null — under the entry routes, which have
 * no pane of their own, the *document* is what scrolls, so the walk finds
 * nothing there and a null scroller would silently turn a caller's scroll
 * nudge into a no-op.
 *
 * `requireOverflow` (default true) additionally requires the ancestor to be
 * overflowing *right now* (`scrollHeight > clientHeight`) — what the
 * keyboard-avoidance callers below want, since they're deciding whether
 * there's anything to scroll. FlipList wants the other contract: see its call
 * site for why.
 */
export function findScrollParent(
  el: HTMLElement,
  opts?: { requireOverflow?: boolean },
): HTMLElement | null {
  const requireOverflow = opts?.requireOverflow ?? true
  let node = el.parentElement
  while (node) {
    const style      = getComputedStyle(node)
    const scrollable = style.overflowY === 'auto' || style.overflowY === 'scroll'
    if (scrollable && (!requireOverflow || node.scrollHeight > node.clientHeight)) return node
    node = node.parentElement
  }
  return document.scrollingElement as HTMLElement | null
}
