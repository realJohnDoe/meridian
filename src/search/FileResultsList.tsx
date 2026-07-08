import { useMemo } from 'react'
import type { Occurrence } from '@/types'
import { fileEntries, backlinksTo } from '@/fileOccurrence'
import { OccurrenceCard } from '@/components'
import { useStore } from '@/store'
import { matchesQuery, scoreQuery } from '@/lib/matching'

interface Props {
  query: string
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
export default function FileResultsList({ query, onOpen }: Props) {
  const roots    = useStore(s => s.roots)
  const occBySlug = useStore(s => s.fom)

  const results = useMemo(() => {
    if (!query) return []
    const entries = fileEntries(roots)
    return entries
      .filter(e => {
        const haystack = [e.title, ...e.tags, ...e.items].join(' ')
        return matchesQuery(query, haystack)
      })
      .map(e => ({ entry: e, score: scoreQuery(query, e.title) }))
      .sort((a, b) => b.score - a.score)
      .map(x => ({
        entry: x.entry,
        listedOn: backlinksTo(x.entry.fileSlug, roots).map(slug => roots.get(slug)?.title ?? slug),
      }))
  }, [roots, query])

  if (!results.length) return null

  return (
    <div className="flex flex-col gap-1.5 px-2 pt-2">
      {results.map(({ entry, listedOn }, i) => {
        const occ = occBySlug.get(entry.fileSlug)
        if (!occ) return null
        return (
          <div
            key={entry.fileSlug}
            style={{ '--stagger': `${i * 0.025}s` } as React.CSSProperties}
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
