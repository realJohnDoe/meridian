import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import { isSeries } from '../../types'
import { fileEntries } from '../../presentation'
import { rootsField, itemsField } from './wikilinkDecorations'

// ── Kind icon SVGs (Lucide paths, viewBox 0 0 24 24) ─────────────────────────

type Kind = 'task' | 'event' | 'note'

function kindIcon(kind: Kind): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '13')
  svg.setAttribute('height', '13')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.style.flexShrink = '0'

  const pathsByKind: Record<Kind, string[]> = {
    task: [
      '<rect width="18" height="18" x="3" y="3" rx="2"/>',
      '<path d="m9 12 2 2 4-4"/>',
    ],
    event: [
      '<rect width="18" height="18" x="3" y="4" rx="2"/>',
      '<line x1="16" x2="16" y1="2" y2="6"/>',
      '<line x1="8" x2="8" y1="2" y2="6"/>',
      '<line x1="3" x2="21" y1="10" y2="10"/>',
      '<path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/>',
      '<path d="M8 18h.01"/><path d="M12 18h.01"/>',
    ],
    note: [
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>',
      '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
      '<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    ],
  }

  svg.innerHTML = pathsByKind[kind].join('')
  return svg
}

// ── Completion source ─────────────────────────────────────────────────────────

function wikilinkCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]\n]*/)
  if (!match) return null

  const roots = context.state.field(rootsField)
  const items = context.state.field(itemsField)
  const query = match.text.slice(2).toLowerCase()
  const entries = fileEntries(roots)

  const options: Completion[] = entries
    .filter(e => !query || e.title.toLowerCase().includes(query))
    .slice(0, 8)
    .map(e => {
      // Determine kind from the first non-series item for this fileSlug
      const storeItem = items.find(it => it.fileSlug === e.fileSlug && !isSeries(it))
      const kind: Kind =
        storeItem && 'metadata' in storeItem && storeItem.metadata.done !== undefined ? 'task'
        : storeItem && storeItem.date ? 'event'
        : 'note'

      return {
        label: e.title,
        apply: `[[${e.title}]]`,
        // Encode kind in the type field so addToOptions can read it per row
        type: kind,
      }
    })

  if (!options.length) return null
  return { from: match.from, options, filter: false }
}

// ── Autocomplete extension + tooltip base theme ───────────────────────────────
// EditorView.baseTheme() is unscoped — applies to tooltips appended to <body>.

export const autocompleteTooltipTheme = EditorView.baseTheme({
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: 'var(--popover)',
    border: '1px solid var(--input)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 8px 32px rgba(0,0,0,.4)',
    minWidth: '210px',
    overflow: 'hidden',
    padding: '0',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font)',
    fontSize: '0.875rem',
    maxHeight: '200px',
    overflow: 'auto',
    padding: '0.25rem 0',
    margin: '0',
    listStyle: 'none',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '0.5rem 0.875rem',
    color: 'var(--secondary-foreground)',
    cursor: 'pointer',
    lineHeight: '1.5',
    display: 'flex',
    alignItems: 'center',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--accent)',
    color: 'var(--secondary-foreground)',
  },
  // Hide CM6's built-in type-letter icon column
  '.cm-completionIcon': {
    display: 'none',
  },
})

export const wikilinkAutocomplete = autocompletion({
  override: [wikilinkCompletionSource],
  activateOnTyping: true,
  closeOnBlur: true,
  // addToOptions inserts a DOM node per row at the given slot position.
  // Position 20 is between the (hidden) cm-completionIcon and the label at 50.
  addToOptions: [{
    render(completion) {
      return kindIcon((completion.type ?? 'note') as Kind)
    },
    position: 20,
  }],
})
