import {
  Decoration, type DecorationSet,
  ViewPlugin, type ViewUpdate,
  EditorView,
} from '@codemirror/view'
import type { Extension } from '@codemirror/state'

// Marks the sole line of an empty, unfocused document so a placeholder can
// be painted with a CSS `::before` instead of CM6's built-in `placeholder()`
// widget. That widget inserts a real (aria-hidden) DOM node right at the
// caret position — on Android Firefox this throws off the native, invisible
// caret used to anchor the touch text-selection handle, hanging it in the
// wrong spot until the first character is typed (the line stops being
// "empty except for a widget" and native caret placement is correct
// again). A pseudo-element paints over a line that stays genuinely empty,
// so native caret placement never differs from any other empty line.
//
// Hidden as soon as the editor is focused (not just once typing starts): a
// `::before` renders ahead of the (empty) line's real content, so the caret
// sits after the placeholder text rather than blended with/replacing it —
// leaving it up during focus reads as the cursor "popping up at the end" of
// the placeholder. Dropping it on focus makes the click feel like it
// replaces the prompt, matching how most note-editor placeholders behave.
const emptyLineDeco = Decoration.line({ class: 'cm-empty-placeholder' })

export function build(view: EditorView): DecorationSet {
  return view.state.doc.length === 0 && !view.hasFocus
    ? Decoration.set([emptyLineDeco.range(0)])
    : Decoration.none
}

export const emptyPlaceholder = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = build(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.focusChanged) this.decorations = build(update.view)
    }
  },
  { decorations: v => v.decorations },
)

export function emptyPlaceholderTheme(text: string): Extension {
  return EditorView.theme({
    '.cm-empty-placeholder::before': {
      content: `"${text}"`,
      color: 'var(--muted-foreground)',
      pointerEvents: 'none',
    },
  })
}
