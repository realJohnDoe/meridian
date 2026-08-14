// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { build, rootsField, vaultIdField, itemsField } from './wikilinkDecorations'
import { visibleLineRanges } from './viewUtils'
import type { FileMetadata, Roots } from '@/types'
import { entryKey } from '@/fileIO'

const VAULT = 'test-vault'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views.length = 0
})

function mkFile(title: string, fileSlug: string): FileMetadata {
  return { title, tags: [], items: [], vaultId: VAULT, fileSlug }
}

function mkView(doc: string, roots: Roots = new Map()): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      rootsField.init(() => roots),
      // A wikilink resolves only within its own vault, so the decorations need
      // to know which one the document belongs to.
      vaultIdField.init(() => VAULT),
      itemsField.init(() => []),
    ],
  })
  const view = new EditorView({ state })
  document.body.appendChild(view.dom)
  views.push(view)
  return view
}

function rangesOf(decos: ReturnType<typeof build>, docLength: number) {
  const out: { from: number; to: number }[] = []
  decos.between(0, docLength, (from, to) => { out.push({ from, to }) })
  return out
}

describe('wikilinkDecorations build()', () => {
  it('replaces a resolved wikilink with a chip covering exactly its [[...]] span', () => {
    const roots: Roots = new Map([[entryKey(VAULT, 'some-note'), mkFile('Some Note', 'some-note')]])
    const view = mkView('before [[some-note]] after', roots)

    const decos = build(view, { current: () => {} })
    const ranges = rangesOf(decos, view.state.doc.length)

    expect(ranges).toEqual([
      { from: 'before '.length, to: 'before [[some-note]]'.length },
    ])
  })

  it('marks (does not replace) a wikilink on the focused cursor line', () => {
    const roots: Roots = new Map([[entryKey(VAULT, 'some-note'), mkFile('Some Note', 'some-note')]])
    const view = mkView('[[some-note]]', roots)
    view.focus()
    view.dispatch({ selection: { anchor: 0 } })

    const decos = build(view, { current: () => {} })
    const ranges = rangesOf(decos, view.state.doc.length)

    // Still spans the full wikilink, but as a mark (raw text stays editable),
    // not a replace widget.
    expect(ranges).toEqual([{ from: 0, to: '[[some-note]]'.length }])
  })

  it('only builds decorations for lines within the viewport on a long document', () => {
    const lineCount = 300
    const lines = Array.from({ length: lineCount }, (_, i) => `line ${i} [[note-${i}]] text`)
    const doc = lines.join('\n')
    const roots: Roots = new Map(lines.map((_, i) => [entryKey(VAULT, `note-${i}`), mkFile(`Note ${i}`, `note-${i}`)]))
    const view = mkView(doc, roots)

    const visible = visibleLineRanges(view)
    expect(visible.length).toBeGreaterThan(0)
    // Sanity check that jsdom's layout estimate doesn't just report the whole
    // document as visible — otherwise this test wouldn't exercise the scoping.
    const lastVisibleTo = visible[visible.length - 1]!.to
    expect(lastVisibleTo).toBeLessThan(doc.length)

    const decos = build(view, { current: () => {} })
    const ranges = rangesOf(decos, doc.length)

    expect(ranges.length).toBeGreaterThan(0)
    expect(ranges.length).toBeLessThan(lineCount)
    for (const r of ranges) {
      expect(r.to).toBeLessThanOrEqual(lastVisibleTo)
    }
  })
})
