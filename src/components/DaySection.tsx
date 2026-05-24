import { useRef, useLayoutEffect } from 'react'
import { CalendarRange } from 'lucide-react'
import type { Occurrence } from '../types'
import { parseDateString } from '../recurrence'
import { fmtShort, fmtLong } from '../meridian'
import OccurrenceRow from './OccurrenceRow'

interface Props {
  dateKey: string
  date: Date
  isToday: boolean
  isTomorrow: boolean
  multidayBanners: Occurrence[]
  items: Occurrence[]         // non-multiday, pre-sorted
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => void
}

export default function DaySection({
  dateKey, date, isToday, isTomorrow,
  multidayBanners, items,
  onOpen, onToggleDone, onSwipeDelete,
}: Props) {
  const sectionRef = useRef<HTMLDivElement>(null)
  // Stores the top position of each row (by occ-key) from the previous render.
  const prevTops = useRef<Record<string, number>>({})

  // FLIP re-sort animation.
  // After React commits the new order, compare each row's current top with the
  // top it had in the previous render.  Apply an inverse translate then animate
  // it away so items appear to glide into their new positions.
  useLayoutEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const wraps = section.querySelectorAll<HTMLElement>('.swipe-wrap[data-occ-key]')
    const newTops: Record<string, number> = {}

    wraps.forEach(wrap => {
      const key = wrap.getAttribute('data-occ-key')!
      const curr = wrap.getBoundingClientRect().top
      const prev = prevTops.current[key]

      if (prev !== undefined) {
        const dy = prev - curr
        if (Math.abs(dy) > 1) {
          wrap.style.transition = 'none'
          wrap.style.transform = `translateY(${dy}px)`
          // Force reflow so the browser registers the translate before we remove it.
          void wrap.offsetHeight
          requestAnimationFrame(() => {
            wrap.style.transition = 'transform .35s cubic-bezier(.4,0,.2,1)'
            wrap.style.transform = ''
            wrap.addEventListener('transitionend', () => { wrap.style.transition = '' }, { once: true })
          })
        }
      }

      newTops[key] = curr
    })

    prevTops.current = newTops
  }, [items]) // re-run whenever items order changes

  const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : fmtLong(date)

  return (
    <div className="day-section" data-key={dateKey} ref={sectionRef}>
      <div className={`day-lbl${isToday ? ' tl' : ''}`}>{label}</div>

      {/* Multiday banners */}
      {multidayBanners.map(o => (
        <div key={o._nodeId} className="multiday-banner" onClick={() => onOpen(o)}>
          <CalendarRange size={14} />
          {o.title}
          <span style={{ opacity: 0.55, fontSize: 10, marginLeft: 4 }}>
            {fmtShort(parseDateString(o.multiday!.start))}–{fmtShort(parseDateString(o.multiday!.end))}
          </span>
        </div>
      ))}

      {/* Regular occurrence rows */}
      {items.map((o, i) => (
        <OccurrenceRow
          key={`${o._nodeId}-${o.date}-${o.time ?? ''}`}
          occ={o}
          index={i}
          onOpen={() => onOpen(o)}
          onToggleDone={() => onToggleDone(o)}
          onSwipeDelete={() => onSwipeDelete(o)}
        />
      ))}
    </div>
  )
}
