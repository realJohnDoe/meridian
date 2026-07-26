import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { Autolink } from '@lezer/markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { buildTaskLineMap } from './taskLines'

/**
 * Create an EditorState with the same markdown language config as the app, with
 * a guaranteed-complete syntax tree.
 *
 * `EditorState.create` only parses within a 20 ms budget and keeps whatever
 * partial tree it has when that runs out, so on a loaded machine `syntaxTree`
 * can be missing later lines. `ensureSyntaxTree` alone does not fix this: it
 * advances the parse *context* but `LanguageState.tree` is captured at
 * construction, so `syntaxTree(state)` still returns the stale partial tree.
 * Dispatching an empty transaction rebuilds `LanguageState` from the advanced
 * context — the same trick `forceParsing` uses for views.
 */
function mkState(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Autolink] })],
  })
  ensureSyntaxTree(state, state.doc.length, Infinity)
  return state.update({}).state
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

  describe('ranges param (viewport scoping)', () => {
    it('only finds tasks whose line falls inside the given ranges', () => {
      const doc = '- [ ] first\n- [x] second\n- [ ] third'
      const state = mkState(doc)
      const line1 = state.doc.line(1)

      // Restrict the walk to line 1 only — line 3's task must not appear.
      const map = buildTaskLineMap(state, [{ from: line1.from, to: line1.to }])
      expect([...map.keys()]).toEqual([line1.from])
      expect(map.get(line1.from)!.done).toBe(false)
    })

    it('covers every task when the ranges union spans the whole document', () => {
      const doc = '- [ ] first\n- [x] second\n- [ ] third'
      const state = mkState(doc)
      const full = buildTaskLineMap(state)
      const ranged = buildTaskLineMap(state, [{ from: 0, to: state.doc.length }])
      expect([...ranged.entries()]).toEqual([...full.entries()])
    })

    it('does not use or pollute the whole-document WeakMap cache', () => {
      const state = mkState('- [ ] first\n- [ ] second')
      const line2 = state.doc.line(2)

      // A ranged call scoped to line 2 only should not see line 1's task…
      const ranged = buildTaskLineMap(state, [{ from: line2.from, to: line2.to }])
      expect(ranged.size).toBe(1)
      expect(ranged.has(line2.from)).toBe(true)

      // …and must not have cached that partial result under the plain
      // (no-range) call, which should still see both tasks.
      const full = buildTaskLineMap(state)
      expect(full.size).toBe(2)
    })
  })
})
