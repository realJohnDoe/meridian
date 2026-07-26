// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { Autolink } from '@lezer/markdown'
import { forceParsing } from '@codemirror/language'
import { build } from './taskDecorations'
import { visibleLineRanges } from './viewUtils'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views.length = 0
})

function mkView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Autolink] })],
  })
  const view = new EditorView({ state })
  document.body.appendChild(view.dom)
  views.push(view)
  // `EditorState.create` parses only within a 20 ms budget and keeps a partial
  // tree if that runs out, so on a loaded machine later lines can be missing.
  // `forceParsing` finishes the parse *and* dispatches the empty transaction
  // that makes the result visible to `syntaxTree(view.state)` — see the note in
  // taskLines.test.ts for why `ensureSyntaxTree` alone is not enough.
  forceParsing(view, view.state.doc.length, Infinity)
  return view
}

function rangesOf(decos: ReturnType<typeof build>, docLength: number) {
  const out: { from: number; to: number; className?: string }[] = []
  decos.between(0, docLength, (from, to, deco) => {
    out.push({ from, to, className: (deco.spec as { class?: string }).class })
  })
  return out
}

describe('taskDecorations build()', () => {
  it('replaces the checkbox token with a widget, and strikes through a done task', () => {
    const doc = '- [ ] first\n- [x] second'
    const view = mkView(doc)

    const decos = build(view)
    const ranges = rangesOf(decos, doc.length)

    const line1 = view.state.doc.line(1)
    const line2 = view.state.doc.line(2)

    // Line 1 (unchecked): only the checkbox-replace decoration, no strikethrough.
    const line1Ranges = ranges.filter(r => r.from >= line1.from && r.to <= line1.to)
    expect(line1Ranges).toHaveLength(1)
    expect(view.state.doc.sliceString(line1Ranges[0]!.from, line1Ranges[0]!.to)).toBe('[ ]')

    // Line 2 (checked): checkbox replace + strikethrough over the trailing text.
    const line2Ranges = ranges.filter(r => r.from >= line2.from && r.to <= line2.to)
    expect(line2Ranges).toHaveLength(2)
    const checkbox = line2Ranges.find(r => view.state.doc.sliceString(r.from, r.to) === '[x]')
    const strike = line2Ranges.find(r => r.className === 'cm-task-done')
    expect(checkbox).toBeDefined()
    expect(strike).toBeDefined()
    expect(view.state.doc.sliceString(strike!.from, strike!.to)).toBe('second')
  })

  it('leaves the checkbox raw (no decoration) on the focused cursor line', () => {
    const doc = '- [ ] first'
    const view = mkView(doc)
    view.focus()
    view.dispatch({ selection: { anchor: 0 } })

    const decos = build(view)
    expect(rangesOf(decos, doc.length)).toEqual([])
  })

  it('only builds decorations for tasks within the viewport on a long document', () => {
    const lineCount = 300
    const lines = Array.from({ length: lineCount }, (_, i) => `- [ ] task ${i}`)
    const doc = lines.join('\n')
    const view = mkView(doc)

    const visible = visibleLineRanges(view)
    const lastVisibleTo = visible[visible.length - 1]!.to
    expect(lastVisibleTo).toBeLessThan(doc.length)

    const decos = build(view)
    const ranges = rangesOf(decos, doc.length)

    expect(ranges.length).toBeGreaterThan(0)
    expect(ranges.length).toBeLessThan(lineCount)
    for (const r of ranges) {
      expect(r.to).toBeLessThanOrEqual(lastVisibleTo)
    }
  })
})
