import { useMemo } from 'react'
import type { Occurrence, StoreItem } from '@/types'
import { fileEntries, fileOccurrenceMap } from '@/presentation'
import OccurrenceCard from '@/components/OccurrenceCard'
import { useStore } from '@/store'

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase(), t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++
  return qi === q.length
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase()
  let score = 0, qi = 0, cons = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { qi++; cons++; score += cons } else { cons = 0 }
  }
  if (t.startsWith(q)) score += 100
  return score
}

interface Props {
  query: string
  items: StoreItem[]
  onOpen: (occ: Occurrence) => void
}

/**
 * Deduped, file-granular search results for the bottom-bar filter overlay.
 *
 * Shows one agenda OccurrenceCard per matching file (one representative
 * occurrence per file from fileOccurrenceMap), so no duplicates when a file
 * has multiple occurrences in the range.
 * Tags and topics are matched the same way — no divergence between fields.
 */
export default function FileResultsList({ query, items, onOpen }: Props) {
  const roots = useStore(s => s.roots)

  // One vault expansion for all files — recomputes only when vault data changes,
  // not on every keystroke. Total map: every file slug has a .get() hit,
  // including dateless notes and out-of-window items.
  const occBySlug = useMemo(() => fileOccurrenceMap(items, roots), [items, roots])

  const results = useMemo(() => {
    if (!query) return []
    const entries = fileEntries(roots)
    return entries
      .filter(e => {
        const haystack = [e.title, ...e.tags, ...e.items].join(' ')
        return fuzzyMatch(query, haystack)
      })
      .map(e => ({ entry: e, score: fuzzyScore(query, e.title) }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.entry)
  }, [roots, query])

  if (!results.length) return null

  return (
    <div className="flex flex-col gap-1.5 px-2 pt-2">
      {results.map((entry, i) => {
        const occ = occBySlug.get(entry.fileSlug)
        if (!occ) return null
        return (
          <div
            key={entry.fileSlug}
            style={{ '--stagger': `${i * 0.025}s` } as React.CSSProperties}
          >
            <OccurrenceCard
              occ={occ}
              taskCheckbox={false}
              eventNoteIcon
              showTime="badge"
              showDate
              onOpen={() => onOpen(occ)}
              onToggleDone={() => {}}
            />
          </div>
        )
      })}
    </div>
  )
}
