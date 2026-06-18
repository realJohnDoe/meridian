import { StateEffect, StateField, RangeSetBuilder, Prec, type Extension } from '@codemirror/state'
import {
  Decoration, type DecorationSet,
  ViewPlugin, type ViewUpdate,
  EditorView,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { createElement, type MouseEvent as ReactMouseEvent } from 'react'
import type { Roots, StoreItem, Occurrence } from '../../types'
import { parseWikilinks, resolveWikilink } from '../../wikilinks'
import { fileOccurrenceMap } from '../../presentation'
import OccurrenceCard from '../../components/OccurrenceCard'
import TagChip from '../../components/TagChip'
import { Badge } from '../../components/ui/badge'
import { cn } from '../../lib/utils'
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

// ── Chip widget (reuses the design-system TagChip / Badge) ────────

class ChipWidget extends ReactWidget {
  constructor(
    readonly label: string,
    readonly resolved: boolean,
    readonly ref: string,
    private readonly onClick: () => void,
  ) { super() }

  protected get inline() { return true }

  renderReact() {
    const chip = this.resolved
      // Resolved link → the exact indigo topic chip from the tag line,
      // underlined like the interactive topic chips there.
      ? createElement(TagChip, {
          label: this.label,
          isTopic: true,
          className: 'underline underline-offset-2 decoration-indigo-400/60',
        })
      // Broken link → same Badge base, recoloured destructive, underlined.
      : createElement(
          Badge,
          {
            variant: 'link' as const,
            className: cn('!bg-destructive/15 !text-destructive underline underline-offset-2 decoration-destructive/60'),
          },
          this.label,
        )
    return createElement(
      'span',
      {
        style: { cursor: 'pointer' },
        onMouseDown: (e: ReactMouseEvent) => { e.preventDefault(); this.onClick() },
      },
      chip,
    )
  }

  eq(other: ChipWidget): boolean {
    return other.label === this.label && other.resolved === this.resolved && other.ref === this.ref
  }
}

// ── Occurrence-card widget (React — few per doc) ──────────────────

class OccCardWidget extends ReactWidget {
  constructor(
    readonly occ: Occurrence,
    readonly fileSlug: string,
    readonly numberLabel: string,   // ordered-list number (e.g. "2."), '' for bullets
    readonly padLeft: string,       // the line's padding-left, to recover full width
    readonly indentEm: number,      // nesting indent in em (0 = top level)
    readonly lineFrom: number,      // for the edit-on-marker click and eq() freshness
    private readonly onOpen: () => void,
    private readonly onEdit: () => void,
    private readonly onToggleDone: () => void,
  ) { super() }

  protected get domClassName() { return 'cm-occ-card' }

  // The list line's `text-indent: -padLeft` already pulls this inline widget to
  // the normal-text left edge; `padding-left` shrank the line box by the same
  // amount, so add it back to width to reach the text's right edge. Nested
  // items shift right by `indentEm` for visual hierarchy. line-height: normal
  // stops the editor's 1.85 leading from making the card taller than the
  // "Linked from" cards.
  protected get containerStyle(): Partial<CSSStyleDeclaration> {
    return {
      width: `calc(100% + ${this.padLeft} - ${this.indentEm}em)`,
      marginLeft: `${this.indentEm}em`,
      marginTop: '3px',
      marginBottom: '3px',
      lineHeight: 'normal',
    }
  }

  renderReact() {
    const card = createElement(
      'div',
      { style: { flex: '1 1 0', minWidth: 0 } },
      createElement(OccurrenceCard, {
        occ: this.occ,
        taskCheckbox: this.occ.metadata.done !== undefined,
        eventNoteIcon: this.occ.metadata.done === undefined,
        showTime: 'none' as const,
        showTagsParticipants: false,
        onOpen: this.onOpen,
        onToggleDone: this.onToggleDone,
      }),
    )
    const children = []
    if (this.numberLabel) {
      // Fixed-width box (= the line's hanging indent) so the card always starts
      // at the same x regardless of the digit glyph's width — keeps the card
      // left edges aligned down an ordered list. Click it to place the cursor.
      children.push(createElement(
        'span',
        {
          key: 'num',
          className: 'cm-occ-num',
          style: { width: this.padLeft },
          onMouseDown: (e: ReactMouseEvent) => { e.preventDefault(); this.onEdit() },
        },
        this.numberLabel,
      ))
    }
    children.push(card)
    return createElement('div', { style: { display: 'flex', alignItems: 'stretch' } }, ...children)
  }

  eq(other: OccCardWidget): boolean {
    return other.fileSlug === this.fileSlug
      && other.occ === this.occ
      && other.numberLabel === this.numberLabel
      && other.padLeft === this.padLeft
      && other.indentEm === this.indentEm
      && other.lineFrom === this.lineFrom
  }
}

// ── Regex to detect a list item whose content is solely a wikilink ─

const SOLE_WL_RE = /^\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]$/

// ── Build decorations ─────────────────────────────────────────────

function build(
  view: EditorView,
  onOpenRef: { current: (ref: string) => void },
  onToggleDoneRef: { current: (occ: Occurrence) => void },
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

  // Find sole-wikilink list-item lines → OccurrenceCard widget. We replace the
  // whole line with a flex [number?][card] row: the number shows for ordered
  // lists, bullets are dropped, and the card fills the rest of the row out to
  // the text's right edge. Nesting depth indents the card for visual hierarchy.
  type CardInfo = {
    occ: Occurrence
    fileSlug: string
    numberLabel: string
    padLeft: string
    indentEm: number
  }
  const cardMap = new Map<number, CardInfo>()
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== 'ListItem') return
      const mark = node.node.getChild('ListMark')
      if (!mark) return
      const line = doc.lineAt(node.from)
      if (cursorLines.has(line.number)) return
      const after = doc.sliceString(mark.to, line.to)
      const m = SOLE_WL_RE.exec(after.trim())
      if (!m) return
      const ref = m[1].trim()
      const fileSlug = resolveWikilink(ref, roots)
      if (!fileSlug) return
      const occ = occMap.get(fileSlug)
      if (!occ) return

      const ordered = node.node.parent?.name === 'OrderedList'
      const markText = doc.sliceString(mark.from, mark.to)
      const digits = markText.replace(/\D/g, '').length || 1
      // Mirror markdownListTheme's hanging indent so width recovery is exact.
      const padLeft = ordered ? `calc(${digits}ch + 0.45em)` : '1.2em'

      // Nesting depth = number of ancestor list nodes (1 = top level).
      let depth = 0
      for (let p = node.node.parent; p; p = p.parent) {
        if (p.name === 'OrderedList' || p.name === 'BulletList') depth++
      }

      cardMap.set(line.from, {
        occ, fileSlug,
        numberLabel: ordered ? markText : '',
        padLeft,
        indentEm: (depth - 1) * 1.2,
      })
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
      // Replace the whole line with the card row (Prec.highest lets this win
      // over markdownLivePreview's bullet/number marker on the same range).
      builder.add(
        line.from,
        line.to,
        Decoration.replace({
          widget: new OccCardWidget(
            cardInfo.occ,
            cardInfo.fileSlug,
            cardInfo.numberLabel,
            cardInfo.padLeft,
            cardInfo.indentEm,
            line.from,
            () => onOpenRef.current(cardInfo.fileSlug),
            () => view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true }),
            () => onToggleDoneRef.current(cardInfo.occ),
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
  onToggleDoneRef: { current: (occ: Occurrence) => void },
): Extension {
  // Prec.highest so our bullet-hiding decoration on card lines wins over
  // markdownLivePreview's bullet widget (both target the ListMark range).
  return Prec.highest(ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = build(view, onOpenRef, onToggleDoneRef) }
      update(update: ViewUpdate) {
        const needsRebuild =
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.transactions.some(tr =>
            tr.effects.some(e => e.is(setRootsEffect) || e.is(setItemsEffect)),
          )
        if (needsRebuild) this.decorations = build(update.view, onOpenRef, onToggleDoneRef)
      }
    },
    { decorations: v => v.decorations },
  ))
}

// ── Theme ─────────────────────────────────────────────────────────

export const wikilinkTheme = EditorView.theme({
  // Inline wikilink chips are rendered with the real TagChip / Badge component
  // (see ChipWidget), so no chip styles are needed here.
  //
  // Inline-block so the list line's hanging indent (text-indent) pulls the
  // card to the normal-text left edge; per-instance width/margins come from
  // the widget's containerStyle (see OccCardWidget).
  '.cm-occ-card': {
    display: 'inline-block',
    verticalAlign: 'top',
  },
  // Ordered-list number shown in a fixed-width box to the left of the card
  // (width is set per-instance to the line's hanging indent). The box keeps the
  // card aligned; the box's own 0.45em tail provides the gap before the card.
  '.cm-occ-num': {
    flexShrink: '0',
    boxSizing: 'border-box',
    textAlign: 'left',
    paddingTop: '10px',
    color: 'var(--muted-foreground)',
    cursor: 'text',
    userSelect: 'none',
  },
})
