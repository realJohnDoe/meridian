// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { caretOffset, caretOnEmptyLine } from './emptyLineCaret'

// Real Firefox 153 numbers at font-size 14px / line-height 1.85, captured via
// Marionette against the running app — see the comment in emptyLineCaret.ts.
const FIREFOX_METRICS = { textHeight: 17.967, lineHeight: 25.9, quirk: true }

describe('caretOffset', () => {
  it('centres a text-height caret in the line box', () => {
    // Firefox draws the correct caret 3.967px below the line top; that is
    // exactly (25.9 - 17.967) / 2, so the offset must reproduce it.
    expect(caretOffset(FIREFOX_METRICS)).toBeCloseTo(3.967, 2)
  })

  it('never returns a negative offset when text is taller than the line box', () => {
    expect(caretOffset({ textHeight: 30, lineHeight: 20, quirk: true })).toBe(0)
  })
})

describe('caretOnEmptyLine', () => {
  const at = (doc: string, anchor: number) =>
    caretOnEmptyLine(EditorState.create({ doc, selection: { anchor } }))

  it('is true for a collapsed caret on an empty document', () => {
    expect(at('', 0)).toBe(true)
  })

  it('is true on a blank line between two non-blank ones', () => {
    expect(at('a\n\nb', 2)).toBe(true)
  })

  it('is false when the line has content', () => {
    expect(at('abc', 1)).toBe(false)
  })

  it('is false for a non-empty selection, which drawSelection sizes differently', () => {
    const state = EditorState.create({ doc: 'a\n\nb', selection: { anchor: 0, head: 3 } })
    expect(caretOnEmptyLine(state)).toBe(false)
  })
})
