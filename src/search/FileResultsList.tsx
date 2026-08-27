import { useEffect, useMemo, useState, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Occurrence } from '@/types'
import { fileEntries } from '@/fileOccurrence'
import { OccurrenceCard } from '@/components'
import { VirtualRows } from '@/components/primitives/virtual-rows'
import { useStore } from '@/store'
import { useFileOccurrenceMap } from '@/hooks'
import { rankByQuery } from '@/lib/matching'

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  /** Scroll container the virtualizer measures against — owned by the caller (SearchOverlay). */
  scrollRef: RefObject<HTMLDivElement | null>
}

// OccurrenceCard min-h-11 + py-2 padding + gap-1.5 (6) between rows ≈ 68px.
// Update if the card padding/gap changes.
const ROW_H = 68

// Delays re-filtering/re-rendering results until typing pauses, so a fast
// typist doesn't re-mount hundreds of cards on every keystroke.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/**
 * Deduped, file-granular search results for the bottom-bar filter overlay.
 *
 * Shows one agenda OccurrenceCard per matching file (one representative
 * occurrence per file from fileOccurrenceMap), so no duplicates when a file
 * has multiple occurrences in the range.
 * Tags and topics are matched the same way — no divergence between fields.
 */
export default function FileResultsList({ query, onOpen, scrollRef }: Props) {
  'use no memo' // TanStack Virtual's useVirtualizer() returns imperative
  // methods over mutable internal state, which the compiler can't safely
  // memoize around — react-hooks/incompatible-library. The compiler already
  // auto-skips memoizing this function for the same reason, so this directive
  // is explicit documentation rather than a functional change; the eslint
  // warning here is expected and permanent, see eslint.config.js.
  const roots     = useStore(s => s.roots)
  const occBySlug = useFileOccurrenceMap()
  const backlinks = useStore(s => s.backlinks)

  const debouncedQuery = useDebouncedValue(query, 150)

  const results = useMemo(() => {
    if (!debouncedQuery) return []
    const entries = fileEntries(roots)
    const ranked = rankByQuery(
      debouncedQuery,
      entries,
      e => [e.title, ...e.tags, ...e.items].join(' '),
      e => e.title,
    )
    // The occurrence is resolved here, not in the render body: a row that
    // cannot resolve one must never reach the virtualizer, or `count` promises
    // a row that nothing draws — the virtualizer still reserves its height and
    // the result is an invisible gap between real results. `fileOccurrenceMap`
    // is total over `roots`, so this drops nothing today; it is what keeps the
    // count and what is drawn incapable of disagreeing if that ever changes.
    return ranked.flatMap(entry => {
      const occ = occBySlug.get(entry.entryKey)
      if (!occ) return []
      return [{
        entry,
        occ,
        listedOn: (backlinks.get(entry.entryKey) ?? []).map(key => roots.get(key)?.title ?? key),
      }]
    })
  }, [roots, backlinks, occBySlug, debouncedQuery])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer() returns functions the compiler can't memoize safely; it correctly skips optimizing this component instead.
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    getItemKey: i => results[i]!.entry.entryKey,  // count === results.length
    overscan: 8,
  })

  if (!results.length) return null

  return (
    // The padding sits on a wrapper, never on the positioned spacer below: the
    // rows are absolutely positioned, so their containing block is the spacer's
    // *padding* box — `left: 0; width: 100%` would resolve against the padded
    // width and cancel the inset entirely, leaving the cards flush against the
    // overlay (and, on mobile, the screen) edge. px-3.5 matches AgendaRow's
    // mx-3.5, so results sit on the same screen edge as every other list.
    <VirtualRows
      className="px-3.5 pt-2"
      virtualizer={virtualizer}
      rows={results}
      rowStyle={(_, vi) => ({ '--stagger': `${vi.index * 0.025}s`, paddingBottom: 6 }) as React.CSSProperties}
      renderRow={({ occ, listedOn }) => (
        <OccurrenceCard
          occ={occ}
          leadingIcon="kind"
          showTime="badge"
          showDate
          listedOn={listedOn}
          onOpen={() => onOpen(occ)}
          onToggleDone={() => {}}
        />
      )}
    />
  )
}
