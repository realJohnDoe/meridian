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

/**
 * `view.visibleRanges` expanded to whole-line boundaries and merged where that
 * expansion causes adjacent ranges to touch or overlap. Lets decoration
 * builders and syntax-tree walks scope their work to what's on screen (plus
 * CodeMirror's own margin) instead of the whole document, while guaranteeing
 * no single line is split across two returned ranges — callers can safely
 * regex/parse each range's text without worrying about a match being cut in
 * half at a range boundary.
 */
export function visibleLineRanges(
  view: Pick<EditorView, 'state' | 'visibleRanges'>,
): { from: number; to: number }[] {
  const { doc } = view.state
  const ranges: { from: number; to: number }[] = []
  for (const { from, to } of view.visibleRanges) {
    const lineFrom = doc.lineAt(from).from
    const lineTo = doc.lineAt(to).to
    const last = ranges[ranges.length - 1]
    if (last && lineFrom <= last.to) {
      last.to = Math.max(last.to, lineTo)
    } else {
      ranges.push({ from: lineFrom, to: lineTo })
    }
  }
  return ranges
}
