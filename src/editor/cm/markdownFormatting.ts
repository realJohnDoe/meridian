import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import {
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

// ── Language ──────────────────────────────────────────────────────

export const markdownLanguage = markdown()

// ── Highlight style ───────────────────────────────────────────────

export const markdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading1, fontWeight: '700', fontSize: '1.5em' },
    { tag: t.heading2, fontWeight: '700', fontSize: '1.25em' },
    { tag: t.heading3, fontWeight: '600', fontSize: '1.1em' },
    { tag: t.strong,   fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.monospace, fontFamily: 'monospace' },
  ]),
)

// ── List item indentation theme ───────────────────────────────────
// hanging-indent so wrapped lines align with the text start, not the marker

export const markdownListTheme = EditorView.theme({
  '.cm-ul-item': { paddingLeft: '1.2em', textIndent: '-1.2em' },
  '.cm-ol-item': { paddingLeft: '1.5em', textIndent: '-1.5em' },
  // Fixed-width, right-aligned marker so the text after `1.` / `2.` aligns
  // regardless of the font's (proportional) digit widths. Right-aligning keeps
  // multi-digit markers (`10.`) flush to the same text column.
  '.cm-ol-marker': {
    display: 'inline-block',
    minWidth: '1.2em',
    textAlign: 'right',
    marginRight: '0.3em',
  },
})

// ── Marker widgets ────────────────────────────────────────────────

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.textContent = '•'
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  eq(): boolean { return true }
  ignoreEvent(): boolean { return false }
}

class OrderedMarkerWidget extends WidgetType {
  constructor(readonly label: string) { super() }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.textContent = this.label
    span.className = 'cm-ol-marker'
    return span
  }
  eq(other: OrderedMarkerWidget): boolean { return other.label === this.label }
  ignoreEvent(): boolean { return false }
}

const bulletDeco = Decoration.replace({ widget: new BulletWidget() })
const hideDeco   = Decoration.replace({})

// ── Plugin 1: list item line decorations (cursor-independent) ─────
// Applies hanging-indent classes to list item lines.

function buildLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc

  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== 'ListItem') return
      const lineFrom = doc.lineAt(node.from).from
      const cls = node.node.parent?.name === 'OrderedList' ? 'cm-ol-item' : 'cm-ul-item'
      builder.add(lineFrom, lineFrom, Decoration.line({ class: cls }))
    },
  })

  return builder.finish()
}

export const markdownListDecos = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildLineDecorations(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildLineDecorations(update.view)
      }
    }
  },
  { decorations: v => v.decorations },
)

// ── Plugin 2: hide / replace syntax marks on non-cursor lines ─────

function buildHideDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc, selection } = view.state

  const cursorLines = new Set<number>()
  for (const r of selection.ranges) {
    const a = doc.lineAt(r.from).number
    const b = doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) cursorLines.add(n)
  }

  syntaxTree(view.state).iterate({
    enter(node) {
      const line = doc.lineAt(node.from)
      if (cursorLines.has(line.number)) return

      if (node.name === 'HeaderMark') {
        // Also consume the space that follows the # marks
        const end =
          node.to < line.to && doc.sliceString(node.to, node.to + 1) === ' '
            ? node.to + 1
            : node.to
        builder.add(node.from, end, hideDeco)
      } else if (node.name === 'EmphasisMark' || node.name === 'CodeMark') {
        builder.add(node.from, node.to, hideDeco)
      } else if (node.name === 'ListMark') {
        const label = doc.sliceString(node.from, node.to)
        if (label === '-' || label === '*' || label === '+') {
          // Unordered → filled circle
          builder.add(node.from, node.to, bulletDeco)
        } else {
          // Ordered → keep the number but render it in a fixed-width box.
          // Consume the trailing space too so the gap comes solely from the
          // marker's margin (keeps first lines and wrapped lines aligned).
          const end =
            node.to < line.to && doc.sliceString(node.to, node.to + 1) === ' '
              ? node.to + 1
              : node.to
          builder.add(
            node.from,
            end,
            Decoration.replace({ widget: new OrderedMarkerWidget(label) }),
          )
        }
      }
    },
  })

  return builder.finish()
}

export const markdownLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildHideDecorations(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildHideDecorations(update.view)
      }
    }
  },
  { decorations: v => v.decorations },
)
