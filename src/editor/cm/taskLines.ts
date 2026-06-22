import { type EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { TASK_ITEM_RE } from '@/items'

export type TaskLineInfo = {
  done: boolean
  checkboxFrom: number  // start of the `[ ]`/`[x]` token
  checkboxTo: number    // end of the token (always checkboxFrom + 3)
  textFrom: number      // first non-space char after the checkbox (strikethrough starts here)
}

// Keyed by EditorState — a state object is immutable, so the result is stable.
// Both decoration plugins call buildTaskLineMap(view.state) per update; the
// second call costs one WeakMap lookup instead of a second tree walk.
const cache = new WeakMap<EditorState, Map<number, TaskLineInfo>>()

/**
 * Walk the syntax tree once and return a map from `line.from` to task metadata
 * for every list item line whose content is a `[ ]` / `[x]` task.
 *
 * Cursor-line filtering is intentionally excluded — that is a view concern.
 * Each decoration plugin applies its own focus/cursor guard before consuming
 * entries from this map.
 */
export function buildTaskLineMap(state: EditorState): Map<number, TaskLineInfo> {
  const cached = cache.get(state)
  if (cached) return cached

  const result = new Map<number, TaskLineInfo>()
  const doc = state.doc

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'ListItem') return
      const mark = node.node.getChild('ListMark')
      if (!mark) return

      const line = doc.lineAt(node.from)
      const after = doc.sliceString(mark.to, line.to)
      const m = TASK_ITEM_RE.exec(after.trim())
      if (!m) return

      const done = m[1] !== ' '
      const leadingSpace = after.length - after.trimStart().length
      const checkboxFrom = mark.to + leadingSpace
      const checkboxTo   = checkboxFrom + 3  // `[ ]` is always 3 chars
      const restOfLine   = doc.sliceString(checkboxTo, line.to)
      const textFrom     = checkboxTo + (restOfLine.length - restOfLine.trimStart().length)

      result.set(line.from, { done, checkboxFrom, checkboxTo, textFrom })
    },
  })

  cache.set(state, result)
  return result
}
