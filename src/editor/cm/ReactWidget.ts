import { WidgetType } from '@codemirror/view'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'

const roots = new WeakMap<HTMLElement, Root>()

/** Base class for CM6 widgets that render React content. */
export abstract class ReactWidget extends WidgetType {
  abstract renderReact(): ReactNode

  /** Optional class applied to the widget's container element. */
  protected get domClassName(): string {
    return ''
  }

  /**
   * Render into an inline `<span>` (for chips that flow inside a line) instead
   * of the default block `<div>` (for full-line card/task widgets).
   */
  protected get inline(): boolean {
    return false
  }

  toDOM(): HTMLElement {
    const el = document.createElement(this.inline ? 'span' : 'div')
    if (this.domClassName) el.className = this.domClassName
    // Reset inherited text-indent so the content isn't shifted by a list
    // item's hanging indent (cm-ul-item sets text-indent: −1.2em).
    el.style.textIndent = '0'
    if (this.inline) {
      // The editor's tall line-height (1.85) would stretch the chip; reset to
      // 1.5 (the app's default) so the chip matches the tag-line badge height.
      el.style.lineHeight = '1.5'
    }
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
