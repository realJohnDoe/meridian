import { Plus } from 'lucide-react'
import type { Occurrence } from '@/types'
import FileResultsList from './FileResultsList'
import { Button } from '@/components/ui/button'

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

/**
 * Shared results body for search: a "Create" row (only when there's a query)
 * followed by the file-granular results list. Used by both the desktop popover
 * (FilterOverlay) and the mobile full-screen layer (MobileSearchOverlay).
 */
export default function SearchResults({ query, onOpen, onCreate }: Props) {
  return (
    <div className="lg:max-w-[720px] lg:mx-auto">
      {query && (
        <Button
          variant="ghost"
          className="w-full justify-start gap-[10px] px-[14px] py-3 h-auto rounded-none border-b border-border text-primary hover:bg-card hover:text-primary"
          onClick={() => onCreate(query)}
          aria-label={`Create "${query}"`}
        >
          <Plus size={14} className="shrink-0" />
          <span>Create "<strong>{query}</strong>"</span>
        </Button>
      )}

      <FileResultsList query={query} onOpen={onOpen} />
    </div>
  )
}
