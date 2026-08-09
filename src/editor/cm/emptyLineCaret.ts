import { ViewPlugin, EditorView, type ViewUpdate } from '@codemirror/view'
import type { EditorState, Extension } from '@codemirror/state'

// Firefox reports the *full CSS line-height* as the client rect of a `<br>`,
// where Chrome/Safari report the glyph height that real text also measures at.
// Measured in Firefox 153 at font-size 14px / line-height 1.85:
//
//   <br>.getClientRects()[0].height   25.9px   ← what Firefox gives
//   Range-over-text .height           17.967px ← what every engine gives
//
// CM6 appends a hidden `<br>` to any line with no other content, and
// drawSelection() sizes the caret from `coordsAtPos()`, which on such a line
// resolves to that `<br>`. So on Firefox the caret renders line-height tall
// until the first character is typed. It's a known Gecko quirk:
// https://discuss.codemirror.net/t/larger-cursor-size-on-empty-line/5965
//
// CM6 only shields against this inside its built-in placeholder() widget's
// coordsAt(), which works by putting real text at the caret. emptyPlaceholder.ts
// deliberately replaced that widget with a CSS `::before` to fix a separate
// Android Firefox bug (the widget's DOM node at the caret displaced the native
// caret that anchors the touch-selection handle), which left the bare `<br>`
// exposed with nothing guarding it.
//
// Reintroducing a node at the caret would risk that Android regression, so this
// corrects the *drawn* caret instead, via `!important` CSS rather than by
// writing inline styles: drawSelection re-sets `style.height` on every redraw,
// so an inline correction gets clobbered depending on measure-phase ordering,
// whereas an `!important` rule wins no matter when the layer redraws.
//
// The override is gated on detecting the quirk by measurement (`<br>` rect
// taller than a text rect), never on user-agent sniffing, so on engines that
// report `<br>` correctly the class is never applied and nothing changes.

const CARET_CLASS = 'cm-empty-line-caret'
const HEIGHT_VAR  = '--cm-empty-caret-height'
const OFFSET_VAR  = '--cm-empty-caret-offset'

export interface CaretMetrics {
  /** Height of a real text rect — what the caret should be. */
  textHeight: number
  /** Height of the line box (the CSS line-height). */
  lineHeight: number
  /** True when this engine oversizes a bare `<br>`'s rect (Gecko). */
  quirk: boolean
}

/** Vertical offset that centres a text-height caret in the line box. */
export function caretOffset(metrics: CaretMetrics): number {
  return Math.max(0, (metrics.lineHeight - metrics.textHeight) / 2)
}

/** True when the caret sits alone on a line with no content to measure. */
export function caretOnEmptyLine(state: EditorState): boolean {
  const sel = state.selection.main
  return sel.empty && state.doc.lineAt(sel.head).length === 0
}

// Probes live in scrollDOM, never contentDOM: CM6's DOMObserver watches
// contentDOM for mutations and would treat stray nodes there as document
// edits. scrollDOM inherits the same font and line-height, so it measures
// identically (verified in Firefox: both yield 17.967 / 25.9).
function measureCaretMetrics(view: EditorView): CaretMetrics | null {
  const host = view.scrollDOM
  const hidden = 'position:absolute;visibility:hidden;top:0;left:0;'

  const textProbe = document.createElement('div')
  textProbe.style.cssText = `${hidden}white-space:pre;`
  const textNode = document.createTextNode('Mg')
  textProbe.appendChild(textNode)

  const brProbe = document.createElement('div')
  brProbe.style.cssText = hidden
  const br = document.createElement('br')
  brProbe.appendChild(br)

  host.appendChild(textProbe)
  host.appendChild(brProbe)

  // The *range* rect is the glyph box; the element's own rect would be the
  // line box instead — measuring the element is precisely the mistake that
  // made an earlier attempt at this fix a silent no-op.
  const range = document.createRange()
  range.setStart(textNode, 0)
  range.setEnd(textNode, textNode.length)
  const textHeight = range.getClientRects()[0]?.height ?? 0
  const brHeight   = br.getClientRects()[0]?.height ?? 0
  const lineHeight = brProbe.getBoundingClientRect().height

  textProbe.remove()
  brProbe.remove()

  if (!textHeight || !lineHeight) return null
  return { textHeight, lineHeight, quirk: brHeight > textHeight + 0.5 }
}

export const emptyLineCaret = ViewPlugin.fromClass(
  class {
    metrics: CaretMetrics | null = null

    constructor(readonly view: EditorView) { this.schedule() }

    update(update: ViewUpdate) {
      // Font swaps and resizes change the metrics, so drop the cache and
      // re-measure rather than correcting to a stale height.
      if (update.geometryChanged) this.metrics = null
      if (update.docChanged || update.selectionSet || update.focusChanged || update.geometryChanged) {
        this.schedule()
      }
    }

    schedule() {
      this.view.requestMeasure({
        key: this,
        read: (view) => this.metrics ?? (this.metrics = measureCaretMetrics(view)),
        write: (metrics, view) => {
          const apply = !!metrics?.quirk && caretOnEmptyLine(view.state)
          view.dom.classList.toggle(CARET_CLASS, apply)
          if (apply) {
            view.dom.style.setProperty(HEIGHT_VAR, `${metrics.textHeight}px`)
            view.dom.style.setProperty(OFFSET_VAR, `${caretOffset(metrics)}px`)
          }
        },
      })
    }

    destroy() {
      this.view.dom.classList.remove(CARET_CLASS)
      this.view.dom.style.removeProperty(HEIGHT_VAR)
      this.view.dom.style.removeProperty(OFFSET_VAR)
    }
  },
)

export const emptyLineCaretTheme: Extension = EditorView.theme({
  // `!important` so drawSelection's inline style.height can't win a later redraw.
  [`&.${CARET_CLASS} .cm-cursor-primary`]: {
    height: `var(${HEIGHT_VAR}) !important`,
    transform: `translateY(var(${OFFSET_VAR}))`,
  },
})
