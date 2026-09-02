import { StateEffect, StateField, RangeSetBuilder, Prec, type Extension } from '@codemirror/state'
import {
  Decoration, type DecorationSet,
  ViewPlugin, type ViewUpdate,
  EditorView,
} from '@codemirror/view'
import { createElement, type MouseEvent as ReactMouseEvent } from 'react'
import type { Roots, StoreItem } from '@/types'
import { parseWikilinks, resolveWikilink } from '@/wikilinks'
import { TagChip } from '@/components'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import { focusedCursorLines, visibleLineRanges } from './viewUtils'
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

/**
 * The vault the document being edited belongs to. Needed because a `[[slug]]`
 * resolves only inside its own vault — without it the decorations would light
 * up a link against an identically-slugged file in some other vault.
 */
export const setVaultIdEffect = StateEffect.define<string | null>()
export const vaultIdField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setVaultIdEffect)) return e.value
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

  protected override get inline() { return true }

  renderReact() {
    const chip = this.resolved
      // Resolved link → the exact indigo topic chip from the tag line,
      // underlined like the interactive topic chips there.
      ? createElement(TagChip, {
          label: this.label,
          isTopic: true,
          className: 'underline underline-offset-2 decoration-current/60',
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

  override eq(other: ChipWidget): boolean {
    return other.label === this.label && other.resolved === this.resolved && other.ref === this.ref
  }
}

// ── Build decorations ─────────────────────────────────────────────

export function build(
  view: EditorView,
  onOpenRef: { current: (ref: string) => void },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc } = view.state
  const roots = view.state.field(rootsField)
  const vaultId = view.state.field(vaultIdField)
  const cursorLines = focusedCursorLines(view)

  for (const { from, to } of visibleLineRanges(view)) {
    const links = parseWikilinks(doc.sliceString(from, to))
    for (const wl of links) {
      const start = from + wl.start
      const end = from + wl.end
      const isCursor = cursorLines.has(doc.lineAt(start).number)
      const target = vaultId ? resolveWikilink(wl.ref, roots, vaultId) : undefined
      const title = target ? (roots.get(target)?.title ?? wl.ref) : wl.ref
      const displayLabel = wl.label ?? title

      if (isCursor) {
        builder.add(
          start, end,
          Decoration.mark({ class: target ? 'wl' : 'wl-broken', attributes: { 'data-ref': wl.ref } }),
        )
      } else if (target) {
        builder.add(
          start, end,
          Decoration.replace({ widget: new ChipWidget(displayLabel, true, wl.ref, () => onOpenRef.current(wl.ref)) }),
        )
      } else {
        builder.add(
          start, end,
          Decoration.replace({ widget: new ChipWidget(wl.ref, false, wl.ref, () => onOpenRef.current(wl.ref)) }),
        )
      }
    }
  }

  return builder.finish()
}

// ── Extension factory ─────────────────────────────────────────────

/**
 * Creates the wikilink decoration ViewPlugin.
 * `rootsField`, `vaultIdField` and `itemsField` must be registered separately
 * in the editor (via `.init()`) so their initial values are set before this
 * plugin runs.
 *
 * Pass a stable ref — the plugin reads `onOpenRef.current` at interaction time
 * so the callback can change without remounting the editor.
 */
export function createWikilinkExtension(
  onOpenRef: { current: (ref: string) => void },
): Extension {
  return Prec.highest(ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = build(view, onOpenRef) }
      update(update: ViewUpdate) {
        const needsRebuild =
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged ||
          update.transactions.some(tr =>
            tr.effects.some(e => e.is(setRootsEffect) || e.is(setVaultIdEffect)),
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
})
