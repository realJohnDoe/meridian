import type { Occurrence } from '@/types'
import SearchResults from './SearchResults'

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

/**
 * Desktop popover: results float above the bottom search bar. Mobile uses the
 * full-screen MobileSearchOverlay instead, so this is gated to md:+.
 */
export default function FilterOverlay({ query, onOpen, onCreate }: Props) {
  if (!query) return null

  return (
    <>
      {/* Backdrop covers the calendar/agenda view so content doesn't bleed through above the popover */}
      <div className="hidden md:block fixed inset-0 z-[24] bg-background/80 backdrop-blur-sm" />
      <div id="filterOverlay" className="hidden md:block md:absolute md:bottom-full md:left-0 md:right-0 z-[25] pointer-events-auto">
        <div className="relative max-h-[calc(100dvh-var(--th)-80px)] flex flex-col">
          <div className="overflow-y-auto [-webkit-overflow-scrolling:touch] bg-background flex-1 min-h-0">
            <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} />
          </div>
        </div>
      </div>
    </>
  )
}
