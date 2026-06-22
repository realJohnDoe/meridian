import { Prec, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration, type DecorationSet,
  ViewPlugin, type ViewUpdate,
  EditorView,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { createElement } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { focusedCursorLines } from './viewUtils'
import { buildTaskLineMap } from './taskLines'
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

// ── Build decorations ─────────────────────────────────────────────

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc } = view.state
  const cursorLines = focusedCursorLines(view)
  const taskLineMap = buildTaskLineMap(view.state)

  for (const [lineFrom, info] of taskLineMap) {
    const line = doc.lineAt(lineFrom)
    // Show raw `[ ]`/`[x]` on the focused cursor's line so the user can edit it.
    if (cursorLines.has(line.number)) continue

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
            update.focusChanged ||
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
