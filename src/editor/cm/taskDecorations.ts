import { Prec, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration, type DecorationSet,
  ViewPlugin, type ViewUpdate,
  EditorView,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { createElement } from 'react'
import { Checkbox } from '../../components/ui/checkbox'
import { ReactWidget } from './ReactWidget'

// ── Task checkbox widget (inline — only replaces the `[ ]`/`[x]` token) ─────

class CheckboxWidget extends ReactWidget {
  constructor(
    readonly done: boolean,
    readonly lineFrom: number,  // for eq() freshness
    private readonly onToggle: () => void,
  ) { super() }

  protected get inline() { return true }

  renderReact() {
    // inline-flex (not the component's default block-level `flex`) so the
    // checkbox flows inline with the text/chips that follow it on the line.
    return createElement(Checkbox, {
      checked: this.done,
      onCheckedChange: this.onToggle,
      className: 'size-4 inline-flex align-middle mr-1',
    })
  }

  eq(other: CheckboxWidget): boolean {
    return other.done === this.done && other.lineFrom === this.lineFrom
  }
}

// ── Detect `[ ]` / `[x]` content after a list mark ───────────────

const TASK_CONTENT_RE = /^\[([ xX])\]\s+(.+)$/

// ── Build decorations ─────────────────────────────────────────────

type TaskInfo = {
  done: boolean
  checkboxFrom: number
  checkboxTo: number
  textFrom: number    // first non-space char after the checkbox (strike starts here)
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc, selection } = view.state

  const cursorLines = new Set<number>()
  for (const r of selection.ranges) {
    const a = doc.lineAt(r.from).number
    const b = doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) cursorLines.add(n)
  }

  const taskMap = new Map<number, TaskInfo>()
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== 'ListItem') return
      const mark = node.node.getChild('ListMark')
      if (!mark) return
      const line = doc.lineAt(node.from)
      if (cursorLines.has(line.number)) return
      const after = doc.sliceString(mark.to, line.to)
      const m = TASK_CONTENT_RE.exec(after.trim())
      if (!m) return

      const done = m[1] !== ' '
      const leadingSpace = after.length - after.trimStart().length
      const checkboxFrom = mark.to + leadingSpace
      const checkboxTo   = checkboxFrom + 3  // `[ ]` is always 3 chars
      // First non-space char after the checkbox — start the strikethrough here
      // so the line doesn't render over the gap between checkbox and content.
      const restOfLine = doc.sliceString(checkboxTo, line.to)
      const textFrom = checkboxTo + (restOfLine.length - restOfLine.trimStart().length)

      taskMap.set(line.from, { done, checkboxFrom, checkboxTo, textFrom })
    },
  })

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const info = taskMap.get(line.from)
    if (!info) continue

    // Replace only the `[ ]`/`[x]` token; the rest of the line (text, wikilinks)
    // is processed by other plugins (wikilinkDecorations, markdownLivePreview).
    builder.add(
      info.checkboxFrom,
      info.checkboxTo,
      Decoration.replace({
        widget: new CheckboxWidget(
          info.done,
          line.from,
          () => view.dispatch({
            changes: { from: info.checkboxFrom, to: info.checkboxTo, insert: info.done ? '[ ]' : '[x]' },
          }),
        ),
      }),
    )
    // Strikethrough the text following the checkbox for done items (starting at
    // the text itself, not the gap after the checkbox).
    if (info.done && info.textFrom < line.to) {
      builder.add(info.textFrom, line.to, Decoration.mark({ class: 'cm-task-done' }))
    }
  }

  return builder.finish()
}

// ── Extension factory ─────────────────────────────────────────────

export function createTaskExtension(): Extension {
  return Prec.highest(ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = build(view) }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged ||
            syntaxTree(update.startState) !== syntaxTree(update.state))
          this.decorations = build(update.view)
      }
    },
    { decorations: v => v.decorations },
  ))
}

// ── Theme ─────────────────────────────────────────────────────────

export const taskTheme = EditorView.theme({
  '.cm-task-done': {
    textDecoration: 'line-through',
    opacity: '0.6',
  },
})
