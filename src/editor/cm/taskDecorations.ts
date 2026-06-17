import { Prec, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration, type DecorationSet,
  ViewPlugin, type ViewUpdate,
  EditorView,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { createElement } from 'react'
import MarkdownTaskCard from '../../components/MarkdownTaskCard'
import { ReactWidget } from './ReactWidget'

// ── Task card widget ──────────────────────────────────────────────

class TaskCardWidget extends ReactWidget {
  constructor(
    readonly text: string,
    readonly done: boolean,
    readonly indentEm: number,
    readonly lineFrom: number,
    private readonly onToggle: () => void,
    private readonly onPromote: () => void,
  ) { super() }

  protected get domClassName() { return 'cm-task-card' }

  protected get containerStyle(): Partial<CSSStyleDeclaration> {
    return {
      width: `calc(100% + 1.2em - ${this.indentEm}em)`,
      marginLeft: `${this.indentEm}em`,
      marginTop: '3px',
      marginBottom: '3px',
      lineHeight: 'normal',
    }
  }

  renderReact() {
    return createElement(MarkdownTaskCard, {
      text: this.text,
      done: this.done,
      onToggle: this.onToggle,
      onPromote: this.onPromote,
    })
  }

  eq(other: TaskCardWidget): boolean {
    return other.text === this.text
      && other.done === this.done
      && other.lineFrom === this.lineFrom
      && other.indentEm === this.indentEm
  }
}

// ── Detect `[ ]` / `[x]` content after a list mark ───────────────

const TASK_CONTENT_RE = /^\[([ xX])\]\s+(.+)$/

// ── Build decorations ─────────────────────────────────────────────

type TaskInfo = {
  text: string
  done: boolean
  checkboxFrom: number
  checkboxTo: number
  indentEm: number
}

function build(
  view: EditorView,
  onPromoteRef: { current: (text: string, done: boolean, lineFrom: number, lineTo: number, view: EditorView) => void },
): DecorationSet {
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
      const text = m[2].trim()
      // Locate `[ ]` / `[x]` start within the doc — skip leading whitespace after mark
      const leadingSpace = after.length - after.trimStart().length
      const checkboxFrom = mark.to + leadingSpace
      const checkboxTo   = checkboxFrom + 3  // `[ ]` is always 3 chars

      let depth = 0
      for (let p = node.node.parent; p; p = p.parent) {
        if (p.name === 'OrderedList' || p.name === 'BulletList') depth++
      }

      taskMap.set(line.from, { text, done, checkboxFrom, checkboxTo, indentEm: (depth - 1) * 1.2 })
    },
  })

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const info = taskMap.get(line.from)
    if (!info) continue

    builder.add(
      line.from,
      line.to,
      Decoration.replace({
        widget: new TaskCardWidget(
          info.text,
          info.done,
          info.indentEm,
          line.from,
          () => view.dispatch({
            changes: { from: info.checkboxFrom, to: info.checkboxTo, insert: info.done ? '[ ]' : '[x]' },
          }),
          () => onPromoteRef.current(info.text, info.done, line.from, line.to, view),
        ),
      }),
    )
  }

  return builder.finish()
}

// ── Extension factory ─────────────────────────────────────────────

export function createTaskExtension(
  onPromoteRef: { current: (text: string, done: boolean, lineFrom: number, lineTo: number, view: EditorView) => void },
): Extension {
  return Prec.highest(ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = build(view, onPromoteRef) }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged)
          this.decorations = build(update.view, onPromoteRef)
      }
    },
    { decorations: v => v.decorations },
  ))
}

// ── Theme ─────────────────────────────────────────────────────────

export const taskTheme = EditorView.theme({
  '.cm-task-card': {
    display: 'inline-block',
    verticalAlign: 'top',
  },
})
