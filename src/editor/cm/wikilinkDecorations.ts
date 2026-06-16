import { StateEffect, StateField, RangeSetBuilder, Prec, type Extension } from '@codemirror/state'
import {
  Decoration, type DecorationSet,
  ViewPlugin, type ViewUpdate,
  WidgetType, EditorView,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { createElement } from 'react'
import type { Roots, StoreItem, Occurrence } from '../../types'
import { parseWikilinks, resolveWikilink } from '../../wikilinks'
import { fileOccurrenceMap } from '../../presentation'
import OccurrenceCard from '../../components/OccurrenceCard'
import { ReactWidget } from './ReactWidget'

// ── State fields ──────────────────────────────────────────────────

export const setRootsEffect = StateEffect.define<Roots>()
export const rootsField = StateField.define<Roots>({
  create: () => new Map(),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setRootsEffect)) return e.value
    return value
  },
})

export const setItemsEffect = StateEffect.define<StoreItem[]>()
export const itemsField = StateField.define<StoreItem[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setItemsEffect)) return e.value
    return value
  },
})

// ── Chip widget (plain DOM — fast, many per doc) ──────────────────

class ChipWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly resolved: boolean,
    readonly ref: string,
    private readonly onClick: () => void,
  ) { super() }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.textContent = this.label
    span.className = this.resolved ? 'cm-wl-chip' : 'cm-wl-chip-broken'
    span.addEventListener('mousedown', e => { e.preventDefault(); this.onClick() })
    return span
  }

  eq(other: ChipWidget): boolean {
    return other.label === this.label && other.resolved === this.resolved && other.ref === this.ref
  }

  ignoreEvent(): boolean { return false }
}

// ── Occurrence-card widget (React — few per doc) ──────────────────

class OccCardWidget extends ReactWidget {
  constructor(
    readonly occ: Occurrence,
    readonly fileSlug: string,
    private readonly onClick: () => void,
  ) { super() }

  renderReact() {
    return createElement(OccurrenceCard, {
      occ: this.occ,
      taskCheckbox: false,
      showTime: 'none' as const,
      showTagsParticipants: false,
      onOpen: this.onClick,
      onToggleDone: () => {},
    })
  }

  eq(other: OccCardWidget): boolean {
    return other.fileSlug === this.fileSlug && other.occ === this.occ
  }
}

// ── Regex to detect a list item whose content is solely a wikilink ─

const SOLE_WL_RE = /^\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]$/

// ── Build decorations ─────────────────────────────────────────────

function build(
  view: EditorView,
  onOpenRef: { current: (ref: string) => void },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc, selection } = view.state
  const roots  = view.state.field(rootsField)
  const items  = view.state.field(itemsField)
  const occMap = fileOccurrenceMap(items, roots)

  // Which lines contain the cursor (show raw text there)
  const cursorLines = new Set<number>()
  for (const r of selection.ranges) {
    const a = doc.lineAt(r.from).number
    const b = doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) cursorLines.add(n)
  }

  // Find sole-wikilink list-item lines → OccurrenceCard block widget
  // key: lineFrom position
  const cardMap = new Map<number, { occ: Occurrence; fileSlug: string }>()
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== 'ListItem') return
      const mark = node.node.getChild('ListMark')
      if (!mark) return
      const line = doc.lineAt(node.from)
      if (cursorLines.has(line.number)) return
      const content = doc.sliceString(mark.to, line.to).trim()
      const m = SOLE_WL_RE.exec(content)
      if (!m) return
      const ref = m[1].trim()
      const fileSlug = resolveWikilink(ref, roots)
      if (!fileSlug) return
      const occ = occMap.get(fileSlug)
      if (!occ) return
      cardMap.set(line.from, { occ, fileSlug })
    },
  })

  // Index all wikilinks by their starting line
  const allLinks = parseWikilinks(doc.toString())
  const linksByLineFrom = new Map<number, typeof allLinks>()
  for (const wl of allLinks) {
    const lf = doc.lineAt(wl.start).from
    if (!linksByLineFrom.has(lf)) linksByLineFrom.set(lf, [])
    linksByLineFrom.get(lf)!.push(wl)
  }

  // Walk lines in order so RangeSetBuilder receives ranges ascending
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const isCursor = cursorLines.has(i)
    const cardInfo = cardMap.get(line.from)

    if (cardInfo && !isCursor) {
      // Replace the full line content with the occurrence card
      builder.add(
        line.from,
        line.to,
        Decoration.replace({
          widget: new OccCardWidget(
            cardInfo.occ,
            cardInfo.fileSlug,
            () => onOpenRef.current(cardInfo.fileSlug),
          ),
        }),
      )
    } else {
      // Process individual wikilinks on this line
      for (const wl of linksByLineFrom.get(line.from) ?? []) {
        const fileSlug = resolveWikilink(wl.ref, roots)
        const title = fileSlug ? (roots.get(fileSlug)?.title ?? wl.ref) : wl.ref
        const displayLabel = wl.label ?? title

        if (isCursor) {
          // Raw text with .wl / .wl-broken styling
          builder.add(
            wl.start, wl.end,
            Decoration.mark({ class: fileSlug ? 'wl' : 'wl-broken', attributes: { 'data-ref': wl.ref } }),
          )
        } else if (fileSlug) {
          builder.add(
            wl.start, wl.end,
            Decoration.replace({ widget: new ChipWidget(displayLabel, true, wl.ref, () => onOpenRef.current(wl.ref)) }),
          )
        } else {
          builder.add(
            wl.start, wl.end,
            Decoration.replace({ widget: new ChipWidget(wl.ref, false, wl.ref, () => onOpenRef.current(wl.ref)) }),
          )
        }
      }
    }
  }

  return builder.finish()
}

// ── Extension factory ─────────────────────────────────────────────

/**
 * Creates the wikilink decoration ViewPlugin.
 * `rootsField` and `itemsField` must be registered separately in the editor
 * (via `.init()`) so their initial values are set before this plugin runs.
 *
 * Pass a stable ref — the plugin reads `onOpenRef.current` at interaction time
 * so the callback can change without remounting the editor.
 */
export function createWikilinkExtension(
  onOpenRef: { current: (ref: string) => void },
): Extension {
  // Prec.highest so card widgets (which replace the full list-item line including
  // the "- " marker) take priority over markdownLivePreview's bullet widget,
  // which otherwise conflicts at the same start position.
  return Prec.highest(ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = build(view, onOpenRef) }
      update(update: ViewUpdate) {
        const needsRebuild =
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.transactions.some(tr =>
            tr.effects.some(e => e.is(setRootsEffect) || e.is(setItemsEffect)),
          )
        if (needsRebuild) this.decorations = build(update.view, onOpenRef)
      }
    },
    { decorations: v => v.decorations },
  ))
}

// ── Theme ─────────────────────────────────────────────────────────

export const wikilinkTheme = EditorView.theme({
  // Resolved wikilink chip — mirrors the "link" Badge variant (bg-indigo-500/15 text-indigo-400)
  '.cm-wl-chip': {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 0.375rem',
    verticalAlign: 'baseline',
    borderRadius: '0.375rem',
    background: 'rgb(99 102 241 / 0.15)',
    color: 'rgb(129 140 248)',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    userSelect: 'none',
    lineHeight: '1.4',
    // Reset inherited text-indent so the chip label isn't shifted when it is
    // the first element on a list item line (cm-ul-item has text-indent: -1.2em).
    textIndent: '0',
  },
  // Broken wikilink chip — mirrors the wl-broken destructive styling
  '.cm-wl-chip-broken': {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 0.375rem',
    verticalAlign: 'baseline',
    borderRadius: '0.375rem',
    background: 'color-mix(in oklab, var(--destructive), transparent 85%)',
    color: 'var(--destructive)',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    userSelect: 'none',
    lineHeight: '1.4',
    textIndent: '0',
  },
  // Container div for occurrence card widgets — add breathing room
  '.cm-occ-card': {
    display: 'block',
    margin: '0.25rem 0',
  },
})
