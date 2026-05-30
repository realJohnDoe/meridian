import { useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { cn } from '@/lib/utils'

const ITEM_H = 44 // px — h-11

interface Props<T extends string | number> {
  items: T[]
  value: T
  onChange: (v: T) => void
  format?: (v: T) => string
  className?: string
}

export function WheelColumn<T extends string | number>({
  items, value, onChange, format, className,
}: Props<T>) {
  const initialIdx = Math.max(0, items.indexOf(value))
  const [selectedIdx, setSelectedIdx] = useState(initialIdx)

  const [emblaRef, emblaApi] = useEmblaCarousel({
    axis: 'y',
    loop: false,
    startIndex: initialIdx,
    align: 'center',
    dragFree: false,
    containScroll: false,
  })

  const onChangeRef = useRef(onChange)
  const itemsRef   = useRef(items)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { itemsRef.current    = items   }, [items])

  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => setSelectedIdx(emblaApi.selectedScrollSnap())
    const onSettle = () => onChangeRef.current(itemsRef.current[emblaApi.selectedScrollSnap()])
    emblaApi.on('select', onSelect)
    emblaApi.on('settle', onSettle)
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('settle', onSettle)
    }
  }, [emblaApi])

  // Sync scroll when external value changes (e.g. dialog open)
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
        {/* paddingBlock lets the first/last items reach center with align:'center' */}
        <div className="flex flex-col" style={{ paddingBlock: ITEM_H }}>
          {items.map((item, i) => (
            <div
              key={i}
              style={{ flex: `0 0 ${ITEM_H}px` }}
              className={cn(
                'flex items-center justify-center text-xl font-mono select-none cursor-pointer',
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
        </div>
      </div>
    </div>
  )
}
