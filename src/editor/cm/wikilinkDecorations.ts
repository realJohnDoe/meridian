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
      // Resolved link → the exact indigo topic chip from the tag line.
      ? createElement(TagChip, { label: this.label, isTopic: true })
      // Broken link → same Badge base, recoloured destructive.
      : createElement(
          Badge,
          { variant: 'link' as const, className: cn('!bg-destructive/15 !text-destructive') },
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
    private readonly onClick: () => void,
  ) { super() }

  protected get domClassName() { return 'cm-occ-card' }

  renderReact() {
    return createElement(OccurrenceCard, {
      occ: this.occ,
      taskCheckbox: false,
      eventNoteIcon: true,
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
  // Inline wikilink chips are rendered with the real TagChip / Badge component
  // (see ChipWidget), so no chip styles are needed here.
  // Container div for occurrence card widgets.
  // margin-left: -1.2em + width: calc(100% + 1.2em) cancels the first-level
  // cm-ul-item padding-left so the card left-aligns with normal (non-list)
  // text.
  '.cm-occ-card': {
    display: 'block',
    marginLeft: '-1.2em',
    width: 'calc(100% + 1.2em)',
    // Adjacent card margins collapse through the empty line wrappers, so the
    // inter-card gap equals this value (not 2×). 6px ≈ the panel's gap-1.5.
    marginTop: '6px',
    marginBottom: '6px',
  },
  // CM6 inserts zero-width <img class="cm-widgetBuffer"> spacers on both sides
  // of a widget. For a full-line block card they add a line-box of leading
  // above and below the card, inflating the row height. Hide them on card
  // lines only (keeping the line's font metrics so cm-ul-item's em-based
  // padding still resolves correctly).
  '.cm-line:has(.cm-occ-card) .cm-widgetBuffer': {
    display: 'none',
  },
})
