import { type EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { TASK_ITEM_RE } from '../items'

export type TaskLineInfo = {
  done: boolean
  checkboxFrom: number  // start of the `[ ]`/`[x]` token
  checkboxTo: number    // end of the token (always checkboxFrom + 3)
  textFrom: number      // first non-space char after the checkbox (strikethrough starts here)
}

// Keyed by EditorState — a state object is immutable, so the result is stable.
// Both decoration plugins call buildTaskLineMap(view.state) per update; the
// second call costs one WeakMap lookup instead of a second tree walk.
// Only populated for whole-document calls (no `ranges` arg) — a range-scoped
// walk is already cheap (bounded by what's on screen), so it isn't worth the
// extra cache-key bookkeeping.
const cache = new WeakMap<EditorState, Map<number, TaskLineInfo>>()

/**
 * Walk the syntax tree and return a map from `line.from` to task metadata for
 * every list item line whose content is a `[ ]` / `[x]` task.
 *
 * Pass `ranges` (e.g. from `visibleLineRanges`) to restrict the walk to those
 * spans of the document instead of the whole thing — decoration builders that
 * only need on-screen lines should always do this, since a full walk costs
 * O(document size) on every keystroke. Omit it for callers that genuinely need
 * every task in the document; that result is WeakMap-cached per state.
 *
 * Cursor-line filtering is intentionally excluded — that is a view concern.
 * Each decoration plugin applies its own focus/cursor guard before consuming
 * entries from this map.
 */
export function buildTaskLineMap(
  state: EditorState,
  ranges?: readonly { from: number; to: number }[],
): Map<number, TaskLineInfo> {
  if (!ranges) {
    const cached = cache.get(state)
    if (cached) return cached
  }

  const result = new Map<number, TaskLineInfo>()
  const doc = state.doc
  const tree = syntaxTree(state)

  // Typed off `tree.iterate` itself (rather than importing SyntaxNodeRef from
  // @lezer/common) since that package isn't a direct dependency here.
  const enter: Parameters<typeof tree.iterate>[0]['enter'] = (node) => {
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
  }

  if (ranges) {
    for (const { from, to } of ranges) tree.iterate({ from, to, enter })
  } else {
    tree.iterate({ enter })
  }

  if (!ranges) cache.set(state, result)
  return result
}
