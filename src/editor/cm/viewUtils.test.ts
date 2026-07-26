import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { visibleLineRanges } from './viewUtils'

/** Minimal fake satisfying the `Pick<EditorView, 'state' | 'visibleRanges'>` shape. */
function fakeView(doc: string, visibleRanges: { from: number; to: number }[]) {
  return { state: EditorState.create({ doc }), visibleRanges }
}

describe('visibleLineRanges', () => {
  it('expands a mid-line range to the containing lines full span', () => {
    const doc = 'aaaa\nbbbb\ncccc\ndddd'
    // "bb|bb" — from/to land inside line 2, not on a line boundary.
    const view = fakeView(doc, [{ from: 6, to: 8 }])
    const line2 = view.state.doc.line(2)
    expect(visibleLineRanges(view)).toEqual([{ from: line2.from, to: line2.to }])
  })

  it('merges two visible ranges whose line-expansion causes overlap', () => {
    const doc = 'aaaa\nbbbb\ncccc\ndddd\neeee'
    // Range 1 sits inside line 1, range 2 inside line 3; expanding each to full
    // lines still leaves a gap (line 2), so they must stay separate.
    const view = fakeView(doc, [{ from: 1, to: 2 }, { from: 11, to: 12 }])
    const line1 = view.state.doc.line(1)
    const line3 = view.state.doc.line(3)
    expect(visibleLineRanges(view)).toEqual([
      { from: line1.from, to: line1.to },
      { from: line3.from, to: line3.to },
    ])
  })

  it('merges adjacent/overlapping visible ranges within the same line', () => {
    const doc = 'aaaaaaaaaa\nbbbb'
    // Two ranges both inside line 1 (simulating wrapped-line viewport pieces).
    const view = fakeView(doc, [{ from: 0, to: 3 }, { from: 4, to: 6 }])
    const line1 = view.state.doc.line(1)
    expect(visibleLineRanges(view)).toEqual([{ from: line1.from, to: line1.to }])
  })

  it('returns an empty array when there are no visible ranges', () => {
    const view = fakeView('abc', [])
    expect(visibleLineRanges(view)).toEqual([])
  })
})
