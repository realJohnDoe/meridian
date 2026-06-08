import { useMemo } from 'react'
import type { Occurrence, StoreItem, Roots } from '../types'
import { backlinksTo, targetOccurrenceMap, sortOccs, occState } from '../presentation'
import { collectUndated } from '../model/expansion'
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

  const occBySlug = useMemo(() => targetOccurrenceMap(items, roots), [items, roots])

  const undatedBySlug = useMemo(() => {
    const map = new Map<string, Occurrence>()
    for (const occ of collectUndated(items, roots)) map.set(occ.fileSlug, occ as Occurrence)
    return map
  }, [items, roots])

  const occs = useMemo(() => {
    const result: Occurrence[] = []
    for (const slug of slugs) {
      const occ = occBySlug.get(slug) ?? undatedBySlug.get(slug)
      if (occ) result.push(occ)
    }
    return sortOccs([...result])
  }, [slugs, occBySlug, undatedBySlug])

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
