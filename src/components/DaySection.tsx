import { memo, useRef, useLayoutEffect } from 'react'
import { CalendarRange } from 'lucide-react'
import type { Occurrence } from '../types'
import { parseDateString } from '../model/expand'
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
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

function DaySection({
  dateKey, date, isToday, isTomorrow,
  multidayBanners, items,
  onOpen, onToggleDone, onSwipeDelete,
}: Props) {
  const sectionRef = useRef<HTMLDivElement>(null)
  // Stores the section-relative top of each row from the previous render.
  const prevTops = useRef<Record<string, number>>({})
  // Tracks item count so we can distinguish reorders from deletions.
  const prevItemCount = useRef(items.length)

  // FLIP re-sort animation.
  // After React commits the new order, compare each row's current top (relative
  // to the section element, so scroll position is irrelevant) with the top it
  // had in the previous render. Apply an inverse translate then animate it away
  // so items appear to glide into their new positions.
  //
  // FLIP only runs on reorders (same item count). On deletions the swipe CSS
  // animation already moved the surviving items into place; running FLIP on top
  // of that would make them slide up a second time.
  useLayoutEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const wasReorder = items.length === prevItemCount.current
    prevItemCount.current = items.length

    // Anchor all measurements to the section so that page scroll between renders
    // doesn't produce false deltas for sections that didn't actually reorder.
    const sectionTop = section.getBoundingClientRect().top

    const wraps = section.querySelectorAll<HTMLElement>('.swipe-wrap[data-occ-key]')
    const newTops: Record<string, number> = {}

    wraps.forEach(wrap => {
      const key = wrap.getAttribute('data-occ-key')!
      const curr = wrap.getBoundingClientRect().top - sectionTop   // section-relative

      if (wasReorder) {
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
      }

      newTops[key] = curr
    })

    prevTops.current = newTops
  }, [items]) // re-run whenever items order/content changes

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

// Only re-render when items actually change order or content.
// This prevents every DaySection from re-rendering (and running the FLIP
// useLayoutEffect) on every store update — only the affected section does.
function propsAreEqual(prev: Props, next: Props): boolean {
  if (prev.isToday !== next.isToday || prev.isTomorrow !== next.isTomorrow) return false
  if (prev.items.length !== next.items.length) return false
  if (prev.multidayBanners.length !== next.multidayBanners.length) return false
  if (!prev.items.every((o, i) => {
    const n = next.items[i]
    return o._nodeId === n._nodeId && o.date === n.date && o.time === n.time
        && o.done === n.done && o.title === n.title && o.priority === n.priority
  })) return false
  if (!prev.multidayBanners.every((o, i) => o._nodeId === next.multidayBanners[i]._nodeId)) return false
  return true
}

export default memo(DaySection, propsAreEqual)
