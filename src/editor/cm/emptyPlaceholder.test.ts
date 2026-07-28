// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { build } from './emptyPlaceholder'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views.length = 0
})

function mkView(doc: string): EditorView {
  const state = EditorState.create({ doc })
  const view = new EditorView({ state })
  document.body.appendChild(view.dom)
  views.push(view)
  return view
}

describe('emptyPlaceholder build()', () => {
  it('marks the sole line when the document is empty', () => {
    const view = mkView('')

    const decos = build(view)
    const ranges: { from: number; to: number; className?: string }[] = []
    decos.between(0, view.state.doc.length, (from, to, deco) => {
      ranges.push({ from, to, className: (deco.spec as { class?: string }).class })
    })

    expect(ranges).toEqual([{ from: 0, to: 0, className: 'cm-empty-placeholder' }])
  })

  it('produces no decorations once the document has content', () => {
    const view = mkView('hello')

    const decos = build(view)

    expect(decos.size).toBe(0)
  })

  it('hides the placeholder as soon as the empty editor is focused', () => {
    const view = mkView('')
    expect(build(view).size).toBeGreaterThan(0)

    view.focus()

    expect(build(view).size).toBe(0)
  })
})
