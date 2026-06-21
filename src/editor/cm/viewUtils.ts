import type { EditorView } from '@codemirror/view'

/**
 * Returns the set of line numbers that currently contain a selection range,
 * but only when the editor is focused. When unfocused (e.g. just opened),
 * returns an empty set so decorations render everywhere rather than suppressing
 * line 1 due to the default cursor position.
 */
export function focusedCursorLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  if (!view.hasFocus) return lines
  const { doc, selection } = view.state
  for (const r of selection.ranges) {
    const a = doc.lineAt(r.from).number
    const b = doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) lines.add(n)
  }
  return lines
}
