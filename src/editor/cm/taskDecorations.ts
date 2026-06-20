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

// ── Task checkbox widget ──────────────────────────────────────────

class TaskCheckboxWidget extends ReactWidget {
  constructor(
    readonly text: string,
    readonly done: boolean,
    readonly indentEm: number,
    readonly lineFrom: number,
    private readonly onToggle: () => void,
  ) { super() }

  protected get domClassName() { return 'cm-task-checkbox' }

  protected get containerStyle(): Partial<CSSStyleDeclaration> {
    return {
      marginLeft: `${this.indentEm}em`,
      lineHeight: 'normal',
    }
  }

  renderReact() {
    return createElement(
      'span',
      { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
      createElement(Checkbox, {
        checked: this.done,
        onCheckedChange: this.onToggle,
        className: 'size-4 shrink-0',
        onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
        onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
      }),
      createElement(
        'span',
        { className: `text-sm${this.done ? ' line-through opacity-60' : ''}` },
        this.text,
      ),
    )
  }

  eq(other: TaskCheckboxWidget): boolean {
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
        widget: new TaskCheckboxWidget(
          info.text,
          info.done,
          info.indentEm,
          line.from,
          () => view.dispatch({
            changes: { from: info.checkboxFrom, to: info.checkboxTo, insert: info.done ? '[ ]' : '[x]' },
          }),
        ),
      }),
    )
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
        if (update.docChanged || update.selectionSet || update.viewportChanged)
          this.decorations = build(update.view)
      }
    },
    { decorations: v => v.decorations },
  ))
}

// ── Theme ─────────────────────────────────────────────────────────

export const taskTheme = EditorView.theme({
  '.cm-task-checkbox': {
    display: 'inline-block',
    verticalAlign: 'middle',
  },
})
