import { memo, useRef, useLayoutEffect } from 'react'
import type { Occurrence } from '../types'
import { multidayDisplayTitle } from '../model/expansion'
import { fmtLong } from '../presentation'
import { cn } from '../lib/utils'
import OccurrenceRow from './OccurrenceRow'


interface Props {
  dateKey: string
  date: Date
  isToday: boolean
  isTomorrow: boolean
  items: Occurrence[]
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

function DaySection({
  dateKey, date, isToday, isTomorrow,
  items,
  onOpen, onToggleDone, onSwipeDelete,
}: Props) {
  const sectionRef = useRef<HTMLDivElement>(null)
  // Stores the section-relative top of each row from the previous render.
  const prevTops = useRef<Record<string, number>>({})
  // Tracks item count so we can distinguish reorders from deletions.
  const prevItemCount = useRef(items.length)

  useLayoutEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const wasReorder = items.length === prevItemCount.current
    prevItemCount.current = items.length

    const sectionTop = section.getBoundingClientRect().top
    const wraps = section.querySelectorAll<HTMLElement>('.swipe-wrap[data-occ-key]')
    const newTops: Record<string, number> = {}

    wraps.forEach(wrap => {
      const key = wrap.getAttribute('data-occ-key')!
      const curr = wrap.getBoundingClientRect().top - sectionTop

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
  }, [items])

  const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : fmtLong(date)

  return (
    <div className="day-section scroll-mt-2" data-key={dateKey} ref={sectionRef}>
      <div className={cn(
        'px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase text-muted-foreground',
        'flex items-center gap-2 sticky top-0 bg-background z-[3]',
        'after:content-[""] after:flex-1 after:h-px after:bg-border',
        isToday && 'text-primary',
      )}>{label}</div>

      {/* Occurrence rows */}
      {items.map((o, i) => (
        <OccurrenceRow
          key={o.id}
          occ={o}
          index={i}
          onOpen={() => onOpen(o)}
          onToggleDone={() => onToggleDone(o)}
          onSwipeDelete={() => onSwipeDelete(o)}
          displayTitle={o.metadata.jsTime ? multidayDisplayTitle(o, o.metadata.jsTime) : undefined}
        />
      ))}
    </div>
  )
}

function propsAreEqual(prev: Props, next: Props): boolean {
  if (prev.isToday !== next.isToday || prev.isTomorrow !== next.isTomorrow) return false
  if (prev.items.length !== next.items.length) return false
  if (!prev.items.every((o, i) => {
    const n = next.items[i]
    return o.fileSlug === n.fileSlug && o.date === n.date && o.time === n.time
        && o.metadata.done === n.metadata.done && o.metadata.title === n.metadata.title
        && o.metadata.priority === n.metadata.priority
        && o.metadata.duration === n.metadata.duration
        && JSON.stringify(o.metadata.tags) === JSON.stringify(n.metadata.tags)
        && JSON.stringify(o.metadata.topics) === JSON.stringify(n.metadata.topics)
        && JSON.stringify(o.metadata.participants) === JSON.stringify(n.metadata.participants)
  })) return false
  return true
}

export default memo(DaySection, propsAreEqual)
