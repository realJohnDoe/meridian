import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { Autolink } from '@lezer/markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { buildTaskLineMap } from './taskLines'

/** Create an EditorState with the same markdown language config as the app. */
function mkState(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Autolink] })],
  })
  // Force the incremental lezer parser to finish before querying.
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

describe('buildTaskLineMap', () => {
  it('returns empty map for plain text', () => {
    const state = mkState('just some text')
    expect(buildTaskLineMap(state).size).toBe(0)
  })

  it('returns empty map for a plain list item (no checkbox)', () => {
    const state = mkState('- buy milk')
    expect(buildTaskLineMap(state).size).toBe(0)
  })

  it('detects an unchecked task', () => {
    const state = mkState('- [ ] buy milk')
    const map = buildTaskLineMap(state)
    expect(map.size).toBe(1)
    const info = map.get(0)!  // line 1 starts at offset 0
    expect(info.done).toBe(false)
  })

  it('detects a checked task (lowercase x)', () => {
    const state = mkState('- [x] done item')
    const map = buildTaskLineMap(state)
    expect(map.size).toBe(1)
    expect(map.get(0)!.done).toBe(true)
  })

  it('detects a checked task (uppercase X)', () => {
    const state = mkState('- [X] also done')
    const map = buildTaskLineMap(state)
    expect(map.size).toBe(1)
    expect(map.get(0)!.done).toBe(true)
  })

  it('detects multiple tasks', () => {
    const doc = '- [ ] first\n- [x] second\n- plain item'
    const state = mkState(doc)
    const map = buildTaskLineMap(state)
    expect(map.size).toBe(2)
    const line1from = state.doc.line(1).from
    const line2from = state.doc.line(2).from
    expect(map.get(line1from)!.done).toBe(false)
    expect(map.get(line2from)!.done).toBe(true)
  })

  it('computes correct checkboxFrom / checkboxTo offsets', () => {
    // "- [ ] text" — the `- ` is 2 chars, so checkbox starts at offset 2
    const state = mkState('- [ ] text')
    const info = buildTaskLineMap(state).get(0)!
    const doc = state.doc
    expect(doc.sliceString(info.checkboxFrom, info.checkboxTo)).toBe('[ ]')
    expect(info.checkboxTo - info.checkboxFrom).toBe(3)
  })

  it('computes textFrom pointing at the first non-space after the checkbox', () => {
    const state = mkState('- [ ] hello')
    const info = buildTaskLineMap(state).get(0)!
    const doc = state.doc
    // textFrom should point at 'h' in 'hello'
    expect(doc.sliceString(info.textFrom, info.textFrom + 5)).toBe('hello')
  })

  it('does not include a wikilink-only line as a task', () => {
    const state = mkState('- [[some-note]]')
    expect(buildTaskLineMap(state).size).toBe(0)
  })

  it('returns the same Map object for the same EditorState (WeakMap cache)', () => {
    const state = mkState('- [ ] cached')
    const first = buildTaskLineMap(state)
    const second = buildTaskLineMap(state)
    expect(first).toBe(second)
  })

  it('returns a different Map for a different EditorState', () => {
    const s1 = mkState('- [ ] first')
    const s2 = mkState('- [ ] second')
    expect(buildTaskLineMap(s1)).not.toBe(buildTaskLineMap(s2))
  })

  it('wikilink after checkbox does not confuse detection', () => {
    // Regression: `- [ ] [[some-note]]` — the line is a task, and the wikilink
    // is part of the task text; it should still be detected as a task line.
    const state = mkState('- [ ] [[some-note]]')
    const map = buildTaskLineMap(state)
    expect(map.size).toBe(1)
    expect(map.get(0)!.done).toBe(false)
  })
})
