import type { RefObject } from 'react'
import { Plus } from 'lucide-react'
import type { Occurrence } from '@/types'
import FileResultsList from './FileResultsList'

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
  /** Scroll container the results virtualizer measures against — owned by SearchOverlay. */
  scrollRef: RefObject<HTMLDivElement | null>
}

/**
 * Shared results body for search: a "Create" row (only when there's a query)
 * followed by the file-granular results list. Used by both the desktop popover
 * (FilterOverlay) and the mobile full-screen layer (MobileSearchOverlay).
 */
export default function SearchResults({ query, onOpen, onCreate, scrollRef }: Props) {
  return (
    <div className="lg:max-w-3xl lg:mx-auto">
      {query && (
        <div className="px-3.5 pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-2.5 pl-3 pr-3.5 py-3.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 shadow-none cursor-pointer hover:bg-primary/10 transition-colors text-primary"
            onClick={() => onCreate(query)}
            aria-label={`Create "${query}"`}
          >
            <Plus size={16} className="shrink-0" />
            <span className="text-sm">Create "<strong>{query}</strong>"</span>
          </button>
        </div>
      )}

      <FileResultsList query={query} onOpen={onOpen} scrollRef={scrollRef} />
    </div>
  )
}
