import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'

// Firefox's `<br>`.getClientRects() reports the *full* CSS line-height for an
// empty line, while Chrome/Safari report the tighter glyph height that real
// text also measures at (a documented Gecko quirk — see
// https://discuss.codemirror.net/t/larger-cursor-size-on-empty-line/5965).
// CM6 only works around this inside its own placeholder() widget's
// coordsAt() — by putting real text at the caret position, it never touches
// the bare-<br> fallback that empty lines otherwise render (CM6 appends a
// hidden <br> to any line with no other content, purely to keep it
// focusable). emptyPlaceholder.ts replaced that widget with a CSS
// `::before` specifically to fix a *different* bug — the widget's real DOM
// node at the caret confused Android Firefox's native touch-selection
// handle (see emptyPlaceholder.ts) — which means the line is now genuinely
// empty and exposes the raw Gecko quirk with nothing guarding it.
//
// Rather than reintroduce DOM content at the caret (risking that same
// touch-handle regression), this measures a real glyph's height with an
// invisible probe and clamps the *drawn* cursor element after the fact —
// leaving the empty line's DOM untouched.

const CLAMP_RATIO = 1.15

function measureGlyphHeight(view: EditorView): number | null {
  const probe = document.createElement('span')
  probe.textContent = 'M'
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.whiteSpace = 'pre'
  view.contentDOM.appendChild(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return height || null
}

/**
 * Clamps `.cm-cursor`'s drawn height to a real glyph's height when the
 * cursor sits on an empty line. Exported standalone so tests can call it
 * directly; the ViewPlugin below schedules it through requestMeasure so it
 * runs after drawSelection's own (possibly wrong) draw for the same frame.
 */
export function fixEmptyLineCursor(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  if (line.length !== 0) return
  const glyphHeight = measureGlyphHeight(view)
  if (glyphHeight == null) return
  const cursor = view.dom.querySelector<HTMLElement>('.cm-cursor')
  if (!cursor) return
  const currentHeight = parseFloat(cursor.style.height)
  if (Number.isFinite(currentHeight) && currentHeight > glyphHeight * CLAMP_RATIO) {
    cursor.style.height = `${glyphHeight}px`
  }
}

const measureKey = {}

export const emptyLineCursorFix = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) { this.schedule() }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.geometryChanged || update.focusChanged) this.schedule()
    }
    schedule() {
      this.view.requestMeasure({ key: measureKey, read: () => {}, write: (_, view) => fixEmptyLineCursor(view) })
    }
  },
)
