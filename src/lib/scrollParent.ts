// Walks up from `el` to find the nearest scrollable ancestor — the container
// a keyboard-avoidance nudge should scroll. Shared by useFloatingCombobox and
// useScrollIntoViewAboveKeyboard.
export function findScrollParent(el: HTMLElement): Element | null {
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return document.scrollingElement
}
