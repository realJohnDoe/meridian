import * as React from 'react'
import useEmblaCarousel, { type UseEmblaCarouselType } from 'embla-carousel-react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

interface CarouselProps {
  opts?: CarouselOptions
  plugins?: CarouselPlugin
  orientation?: 'horizontal' | 'vertical'
  setApi?: (api: CarouselApi) => void
}

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0]
  api: ReturnType<typeof useEmblaCarousel>[1]
  scrollPrev: () => void
  scrollNext: () => void
  canScrollPrev: boolean
  canScrollNext: boolean
} & CarouselProps

const CarouselContext = React.createContext<CarouselContextProps | null>(null)

function useCarousel() {
  const context = React.useContext(CarouselContext)
  if (!context) throw new Error('useCarousel must be used within a <Carousel />')
  return context
}

function Carousel({
  orientation = 'horizontal',
  opts,
  setApi,
  plugins,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    { ...opts, axis: orientation === 'horizontal' ? 'x' : 'y' },
    plugins,
  )
  const [canScrollPrev, setCanScrollPrev] = React.useState(false)
  const [canScrollNext, setCanScrollNext] = React.useState(false)

  const onSelect = React.useCallback((api: CarouselApi) => {
    if (!api) return
    setCanScrollPrev(api.canScrollPrev())
    setCanScrollNext(api.canScrollNext())
  }, [])

  const scrollPrev = React.useCallback(() => api?.scrollPrev(), [api])
  const scrollNext = React.useCallback(() => api?.scrollNext(), [api])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        scrollPrev()
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        scrollNext()
      }
    },
    [scrollPrev, scrollNext],
  )

  React.useEffect(() => {
    if (!api || !setApi) return
    setApi(api)
  }, [api, setApi])

  React.useEffect(() => {
    if (!api) return
    onSelect(api)
    api.on('reInit', onSelect)
    api.on('select', onSelect)
    return () => { api.off('select', onSelect) }
  }, [api, onSelect])

  return (
    <CarouselContext.Provider
      value={{ carouselRef, api, opts, orientation, scrollPrev, scrollNext, canScrollPrev, canScrollNext }}
    >
      <div
        onKeyDownCapture={handleKeyDown}
        className={cn('relative', className)}
        role="region"
        aria-roledescription="carousel"
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  )
}

function CarouselContent({ className, ...props }: React.ComponentProps<'div'>) {
  const { carouselRef, orientation } = useCarousel()
  return (
    <div ref={carouselRef} className="overflow-hidden">
      <div
        className={cn(
          'flex',
          orientation === 'horizontal' ? '-ml-4' : '-mt-4 flex-col',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CarouselItem({ className, ...props }: React.ComponentProps<'div'>) {
  const { orientation } = useCarousel()
  return (
    <div
      role="group"
      aria-roledescription="slide"
      className={cn(
        'min-w-0 shrink-0 grow-0 basis-full',
        orientation === 'horizontal' ? 'pl-4' : 'pt-4',
        className,
      )}
      {...props}
    />
  )
}

function CarouselPrevious({
  className,
  variant = 'outline',
  size = 'icon',
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel()
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        'absolute h-8 w-8 rounded-full',
        orientation === 'horizontal'
          ? '-left-12 top-1/2 -translate-y-1/2'
          : '-top-12 left-1/2 -translate-x-1/2 rotate-90',
        className,
      )}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="sr-only">Previous slide</span>
    </Button>
  )
}

function CarouselNext({
  className,
  variant = 'outline',
  size = 'icon',
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollNext, canScrollNext } = useCarousel()
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        'absolute h-8 w-8 rounded-full',
        orientation === 'horizontal'
          ? '-right-12 top-1/2 -translate-y-1/2'
          : '-bottom-12 left-1/2 -translate-x-1/2 rotate-90',
        className,
      )}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}
    >
      <ArrowRight className="h-4 w-4" />
      <span className="sr-only">Next slide</span>
    </Button>
  )
}

export {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
}

// ── WheelColumn ───────────────────────────────────────────────────────────────
// A vertical scroll-wheel picker built on embla-carousel.
//
// Layout contract (matches the shadcn vertical-carousel example pattern):
//   • align:'start'  — snap target is the TOP of each slide
//   • containScroll:'trimSnaps' — removes only out-of-range snaps; no duplicates
//   • One leading + one trailing inert spacer slide (no pointer-events)
//
// Snap index i  →  spacer(0) | items[0](1) … items[N-1](N) | spacer(N+1)
//
// With align:'start', slide i is at the TOP of the viewport when snapped.
// The middle slot (y = 44..88) therefore shows slide i+1.
// Because slide i+1 = items[i], the mapping is simply:
//
//   selectedScrollSnap() === i  ⟺  items[i] is centred and selected
//
// This is identical to the shadcn example's snap-index = visible-item-index
// relationship, just with a single-item offset provided by the leading spacer.

const WHEEL_ITEM_H = 44 // px — h-11

interface WheelColumnProps<T extends string | number> {
  items: readonly T[]
  value: T
  onChange: (v: T) => void
  /** Optional display formatter, e.g. pad "9" → "09" */
  format?: (v: T) => string
  className?: string
}

export function WheelColumn<T extends string | number>({
  items, value, onChange, format, className,
}: WheelColumnProps<T>) {
  const initialIdx = Math.max(0, items.indexOf(value))
  const [selectedIdx, setSelectedIdx] = React.useState(initialIdx)

  const [emblaRef, emblaApi] = useEmblaCarousel({
    axis: 'y',
    loop: false,
    startIndex: initialIdx,   // snap i → items[i] centred; see contract above
    align: 'start',
    dragFree: false,
    containScroll: 'trimSnaps', // trims trailing-spacer snap; no duplicate positions
  })

  // Stable refs so event callbacks never capture stale closures
  const onChangeRef = React.useRef(onChange)
  const itemsRef   = React.useRef(items)
  React.useEffect(() => { onChangeRef.current = onChange }, [onChange])
  React.useEffect(() => { itemsRef.current    = items   }, [items])

  // Update highlight during scroll; commit value once scroll settles
  React.useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => setSelectedIdx(emblaApi.selectedScrollSnap())
    const onSettle = () => {
      const idx = emblaApi.selectedScrollSnap()
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

  // Sync carousel position when the external value changes (e.g. dialog re-opens)
  React.useEffect(() => {
    if (!emblaApi) return
    const idx = items.indexOf(value)
    if (idx >= 0 && emblaApi.selectedScrollSnap() !== idx) {
      emblaApi.scrollTo(idx, true) // instant — does not fire settle
      setSelectedIdx(idx)
    }
  }, [value, items, emblaApi])

  return (
    <div className={cn('relative h-[132px] overflow-hidden', className)}>
      {/* top fade */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-11 z-10
                      bg-gradient-to-b from-background to-transparent" />
      {/* selection highlight band */}
      <div className="pointer-events-none absolute inset-x-0 top-[44px] h-11 rounded-lg
                      bg-white/5 border border-white/10 z-10" />
      {/* bottom fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 z-10
                      bg-gradient-to-t from-background to-transparent" />

      <div ref={emblaRef} className="h-full overflow-hidden">
        <div className="flex flex-col">
          {/* leading spacer — snap 0 puts this at top → items[0] in centre */}
          <div style={{ flex: `0 0 ${WHEEL_ITEM_H}px` }} className="pointer-events-none shrink-0" />

          {items.map((item, i) => (
            <div
              key={i}
              style={{ flex: `0 0 ${WHEEL_ITEM_H}px` }}
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

          {/* trailing spacer — allows items[N-1] to reach the centre slot;
              trimSnaps removes its own snap position so it is never "selected" */}
          <div style={{ flex: `0 0 ${WHEEL_ITEM_H}px` }} className="pointer-events-none shrink-0" />
        </div>
      </div>
    </div>
  )
}
