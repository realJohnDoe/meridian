import { memo, useRef, useLayoutEffect } from 'react'
import { CalendarRange } from 'lucide-react'
import type { Occurrence } from '../types'
import { parseDateString } from '../recurrence'
import { fmtShort, fmtLong } from '../meridian'
import { cn } from '../lib/utils'
import OccurrenceRow from './OccurrenceRow'

interface Props {
  dateKey: string
  date: Date
  isToday: boolean
  isTomorrow: boolean
  multidayBanners: Occurrence[]
  items: Occurrence[]
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
  const prevTops = useRef<Record<string, number>>({})
  const prevItemCount = useRef(items.length)

  // FLIP re-sort animation — unchanged logic, only class names migrated.
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
    <div className="[scroll-margin-top:8px]" data-key={dateKey} ref={sectionRef}>

      {/* .day-lbl::after (separator line) lives in index.css; class name kept */}
      <div className={cn(
        'day-lbl px-3.5 pt-3.5 pb-[5px] text-[11px] font-bold tracking-[.08em] uppercase',
        'flex items-center gap-2 sticky top-0 bg-bg1 z-[3]',
        isToday ? 'text-ind' : 'text-t3',
      )}>
        {label}
      </div>

      {multidayBanners.map(o => (
        <div
          key={o._nodeId}
          className="mx-3.5 my-0.5 bg-[rgba(129,140,248,.18)] border border-[rgba(129,140,248,.3)] rounded-[6px] px-[10px] py-[5px] text-[12px] text-ind flex items-center gap-1.5 cursor-pointer"
          onClick={() => onOpen(o)}
        >
          <CalendarRange size={14} />
          {o.title}
          <span className="opacity-55 text-[10px] ml-1">
            {fmtShort(parseDateString(o.multiday!.start)!)}–{fmtShort(parseDateString(o.multiday!.end)!)}
          </span>
        </div>
      ))}

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
