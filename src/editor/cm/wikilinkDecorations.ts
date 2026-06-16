import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Roots } from '../../types'
import { parseWikilinks, resolveWikilink } from '../../wikilinks'

// ── Roots state — updated via effect when the React component re-renders ──

export const setRootsEffect = StateEffect.define<Roots>()

export const rootsField = StateField.define<Roots>({
  create: () => new Map(),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setRootsEffect)) return e.value
    }
    return value
  },
})

// ── Wikilink decoration ViewPlugin ────────────────────────────

function buildDecorations(view: import('@codemirror/view').EditorView): DecorationSet {
  const roots = view.state.field(rootsField)
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  const text = doc.toString()
  const links = parseWikilinks(text)

  for (const wl of links) {
    const target = resolveWikilink(wl.ref, roots)
    const cls = target ? 'wl' : 'wl-broken'
    builder.add(
      wl.start,
      wl.end,
      Decoration.mark({ class: cls, attributes: { 'data-ref': wl.ref } }),
    )
  }

  return builder.finish()
}

export const wikilinkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: import('@codemirror/view').EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.transactions.some(tr => tr.effects.some(e => e.is(setRootsEffect)))) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: v => v.decorations },
)
