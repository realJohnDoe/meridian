import { useMemo } from 'react'
import type { Occurrence, StoreItem, Roots } from '../types'
import { backlinksTo, fileOccurrenceMap, sortOccs, occState } from '../presentation'
import OccurrenceCard from './OccurrenceCard'

interface Props {
  fileSlug: string
  items: StoreItem[]
  roots: Roots
  onOpen: (fileSlug: string) => void
  onToggleDone: (occ: Occurrence) => void
}

export default function BacklinksPanel({ fileSlug, items, roots, onOpen, onToggleDone }: Props) {
  const slugs = useMemo(() => backlinksTo(fileSlug, roots), [fileSlug, roots])

  const occBySlug = useMemo(() => fileOccurrenceMap(items, roots), [items, roots])

  const occs = useMemo(() => {
    const result: Occurrence[] = []
    for (const slug of slugs) {
      const occ = occBySlug.get(slug)
      if (occ) result.push(occ)
    }
    return sortOccs([...result])
  }, [slugs, occBySlug])

  if (!occs.length) return null

  return (
    <div className="entry-backlinks">
      <div className="entry-backlinks-label">Linked from</div>
      <div className="flex flex-col gap-1.5">
        {occs.map(occ => (
          <OccurrenceCard
            key={occ.fileSlug}
            occ={occ}
            variant="agenda"
            isDone={!!occ.metadata.done}
            currentBarClass={occState(occ)}
            onOpen={() => onOpen(occ.fileSlug)}
            onToggleDone={() => onToggleDone(occ)}
          />
        ))}
      </div>
    </div>
  )
}
