import type { RefObject } from 'react'
import { Plus } from 'lucide-react'
import type { Occurrence } from '@/types'
import FileResultsList from './FileResultsList'
import { Button } from '@/components/ui/button'

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
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 px-3.5 py-3 h-auto rounded-none border-b border-border text-primary hover:bg-card hover:text-primary"
          onClick={() => onCreate(query)}
          aria-label={`Create "${query}"`}
        >
          <Plus size={14} className="shrink-0" />
          <span>Create "<strong>{query}</strong>"</span>
        </Button>
      )}

      <FileResultsList query={query} onOpen={onOpen} scrollRef={scrollRef} />
    </div>
  )
}
