import { useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { cn } from '@/lib/utils'

const ITEM_H = 44 // px — h-11

interface Props<T extends string | number> {
  items: readonly T[]
  value: T
  onChange: (v: T) => void
  format?: (v: T) => string
  className?: string
}

// ── Layout contract ───────────────────────────────────────────────────────────
//
// Slides = [spacer | items[0] | items[1] | … | items[N] | spacer]
//
// With align:'start', when embla snaps to index s the slide at index s sits at
// the TOP of the 3-item-tall viewport.  The middle slot (the highlighted one)
// therefore holds slide[s+1], which equals items[s].
//
//   emblaSnap s  →  items[s] is centred  →  selectedIdx = s
//
// The spacers let items[0] and items[N] reach the centre position without
// needing CSS padding (which confuses embla's snap-point calculations).

export function WheelColumn<T extends string | number>({
  items, value, onChange, format, className,
}: Props<T>) {
  const initialIdx = Math.max(0, items.indexOf(value))
  const [selectedIdx, setSelectedIdx] = useState(initialIdx)

  const [emblaRef, emblaApi] = useEmblaCarousel({
    axis: 'y',
    loop: false,
    startIndex: initialIdx,
    align: 'start',
    dragFree: false,
    containScroll: 'keepSnaps',
  })

  const onChangeRef = useRef(onChange)
  const itemsRef   = useRef(items)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { itemsRef.current    = items   }, [items])

  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => {
      const snap = emblaApi.selectedScrollSnap()
      // clamp: trailing spacer (index items.length) should not fire
      setSelectedIdx(Math.min(snap, itemsRef.current.length - 1))
    }
    const onSettle = () => {
      const snap = emblaApi.selectedScrollSnap()
      const idx  = Math.min(snap, itemsRef.current.length - 1)
      setSelectedIdx(idx)
      onChangeRef.current(itemsRef.current[idx])
    }
    emblaApi.on('select', onSelect)
    emblaApi.on('settle', onSettle)
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('settle', onSettle)
    }
  }, [emblaApi])

  // Sync scroll when external value changes (e.g. dialog re-opens)
  useEffect(() => {
    if (!emblaApi) return
    const idx = items.indexOf(value)
    if (idx >= 0 && emblaApi.selectedScrollSnap() !== idx) {
      emblaApi.scrollTo(idx, true)
      setSelectedIdx(idx)
    }
  }, [value, items, emblaApi])

  return (
    <div className={cn('relative h-[132px] overflow-hidden', className)}>
      {/* top fade */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-11 z-10 bg-gradient-to-b from-background to-transparent" />
      {/* selection highlight band */}
      <div className="pointer-events-none absolute inset-x-0 top-[44px] h-11 rounded-lg bg-white/5 border border-white/10 z-10" />
      {/* bottom fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 z-10 bg-gradient-to-t from-background to-transparent" />

      <div ref={emblaRef} className="h-full overflow-hidden">
        <div className="flex flex-col">
          {/* leading spacer — allows items[0] to appear in the centre slot */}
          <div style={{ flex: `0 0 ${ITEM_H}px` }} className="pointer-events-none shrink-0" />

          {items.map((item, i) => (
            <div
              key={i}
              style={{ flex: `0 0 ${ITEM_H}px` }}
              className={cn(
                'flex items-center justify-center text-xl font-mono select-none cursor-pointer shrink-0',
                i === selectedIdx ? 'text-foreground' : 'text-muted-foreground',
              )}
              onClick={() => {
                emblaApi?.scrollTo(i)
                setSelectedIdx(i)
                onChange(items[i])
              }}
            >
              {format ? format(item) : String(item)}
            </div>
          ))}

          {/* trailing spacer — allows items[last] to appear in the centre slot */}
          <div style={{ flex: `0 0 ${ITEM_H}px` }} className="pointer-events-none shrink-0" />
        </div>
      </div>
    </div>
  )
}
