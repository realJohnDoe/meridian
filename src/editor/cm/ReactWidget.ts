import { WidgetType } from '@codemirror/view'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'

const roots = new WeakMap<HTMLElement, Root>()

/** Base class for CM6 widgets that render React content. */
export abstract class ReactWidget extends WidgetType {
  abstract renderReact(): ReactNode

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    // Reset inherited text-indent so the card's content isn't shifted by
    // the list item's hanging-indent value (which is −1.2 em by default).
    el.style.textIndent = '0'
    const root = createRoot(el)
    root.render(this.renderReact())
    roots.set(el, root)
    return el
  }

  destroy(dom: HTMLElement): void {
    const root = roots.get(dom)
    if (root) {
      // Defer to avoid "Can't perform a React state update on an unmounted component"
      // when CM6 destroys widgets synchronously during a render cycle.
      setTimeout(() => root.unmount(), 0)
      roots.delete(dom)
    }
  }

  ignoreEvent(): boolean { return false }
}
