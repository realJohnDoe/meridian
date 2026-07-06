import type { Occurrence } from '@/types'
import SearchResults from './SearchResults'

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

/**
 * Desktop popover: results float above the bottom search bar. Touch devices
 * (phone or tablet, e.g. iPad) use the full-screen MobileSearchOverlay
 * instead, so this is gated to fine pointers (mouse/trackpad) only.
 */
export default function FilterOverlay({ query, onOpen, onCreate }: Props) {
  if (!query) return null

  return (
    <div id="filterOverlay" className="hidden fine:block fine:absolute fine:bottom-full fine:left-0 fine:right-0 z-[25] pointer-events-auto">
      <div className="relative max-h-[calc(100dvh-var(--th)-80px)] flex flex-col">
        <div className="overflow-y-auto [-webkit-overflow-scrolling:touch] bg-background flex-1 min-h-0">
          <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} />
        </div>
      </div>
    </div>
  )
}
