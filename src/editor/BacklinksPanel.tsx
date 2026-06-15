import { useMemo, useRef, useLayoutEffect } from 'react'
import type { Occurrence, StoreItem, Roots } from '../types'
import { backlinksTo, fileOccurrenceMap, sortOccs, occState } from '../presentation'
import OccurrenceCard from '@/components/OccurrenceCard'

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

  const listRef = useRef<HTMLDivElement>(null)
  const prevTops = useRef<Record<string, number>>({})
  const prevItemCount = useRef(occs.length)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const wasReorder = occs.length === prevItemCount.current
    prevItemCount.current = occs.length

    const listTop = list.getBoundingClientRect().top
    const wraps = list.querySelectorAll<HTMLElement>('[data-occ-key]')
    const newTops: Record<string, number> = {}

    wraps.forEach(wrap => {
      const key = wrap.getAttribute('data-occ-key')!
      const curr = wrap.getBoundingClientRect().top - listTop

      if (wasReorder) {
        const prev = prevTops.current[key]
        if (prev !== undefined) {
          const dy = prev - curr
          if (Math.abs(dy) > 1) {
            wrap.style.transition = 'none'
            wrap.style.transform = `translateY(${dy}px)`
            void wrap.offsetHeight
            requestAnimationFrame(() => {
              wrap.style.transition = 'transform .35s cubic-bezier(.4,0,.2,1)'
              wrap.style.transform = ''
              wrap.addEventListener('transitionend', () => { wrap.style.transition = '' }, { once: true })
            })
          }
        }
      }

      newTops[key] = curr
    })

    prevTops.current = newTops
  }, [occs])

  if (!occs.length) return null

  return (
    <div className="mt-7 pt-5 border-t border-border">
      <div className="text-2xs font-semibold text-muted-foreground tracking-[.05em] uppercase mb-2.5">Linked from</div>
      <div className="flex flex-col gap-1.5" ref={listRef}>
        {occs.map(occ => (
          <div key={occ.fileSlug} data-occ-key={occ.fileSlug}>
            <OccurrenceCard
              occ={occ}
              variant="compact"
              hideMeta
              isDone={!!occ.metadata.done}
              currentBarClass={occState(occ)}
              onOpen={() => onOpen(occ.fileSlug)}
              onToggleDone={() => onToggleDone(occ)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
