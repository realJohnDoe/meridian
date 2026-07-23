import { useEffect, useMemo, useState, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Occurrence } from '@/types'
import { fileEntries } from '@/fileOccurrence'
import { OccurrenceCard } from '@/components'
import { useStore } from '@/store'
import { matchesQuery, scoreQuery } from '@/lib/matching'

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
  const occBySlug = useStore(s => s.fom)
  const backlinks = useStore(s => s.backlinks)

  const debouncedQuery = useDebouncedValue(query, 150)

  const results = useMemo(() => {
    if (!debouncedQuery) return []
    const entries = fileEntries(roots)
    return entries
      .filter(e => {
        const haystack = [e.title, ...e.tags, ...e.items].join(' ')
        return matchesQuery(debouncedQuery, haystack)
      })
      .map(e => ({ entry: e, score: scoreQuery(debouncedQuery, e.title) }))
      .sort((a, b) => b.score - a.score)
      .map(x => ({
        entry: x.entry,
        listedOn: (backlinks.get(x.entry.fileSlug) ?? []).map(slug => roots.get(slug)?.title ?? slug),
      }))
  }, [roots, backlinks, debouncedQuery])

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    getItemKey: i => results[i].entry.fileSlug,
    overscan: 8,
  })

  if (!results.length) return null

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="px-2 pt-2" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualItems.map(vi => {
        const { entry, listedOn } = results[vi.index]
        const occ = occBySlug.get(entry.fileSlug)
        if (!occ) return null
        return (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{
              '--stagger': `${vi.index * 0.025}s`,
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vi.start}px)`,
              paddingBottom: 6,
            } as React.CSSProperties}
          >
            <OccurrenceCard
              occ={occ}
              leadingIcon="kind"
              showTime="badge"
              showDate
              listedOn={listedOn}
              onOpen={() => onOpen(occ)}
              onToggleDone={() => {}}
            />
          </div>
        )
      })}
    </div>
  )
}
