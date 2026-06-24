import { Plus } from 'lucide-react'
import type { Occurrence } from '@/types'
import FileResultsList from './FileResultsList'
import { Button } from '@/components/ui/button'

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

export default function FilterOverlay({ query, onOpen, onCreate }: Props) {
  if (!query) return null

  return (
    <div id="filterOverlay" className="absolute bottom-full left-0 right-0 z-[25] pointer-events-auto">
      <div className="relative max-h-[calc(100svh-var(--th)-80px)] flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-11 z-10 bg-gradient-to-b from-background to-transparent" />
        <div className="overflow-y-auto [-webkit-overflow-scrolling:touch] bg-background flex-1 min-h-0">
          <div className="lg:max-w-[720px] lg:mx-auto">
            {/* "Create" row */}
            <Button
              variant="ghost"
              className="w-full justify-start gap-[10px] px-[14px] py-3 h-auto rounded-none border-b border-border text-primary hover:bg-card hover:text-primary"
              onClick={() => onCreate(query)}
              aria-label={`Create "${query}"`}
            >
              <Plus size={14} className="shrink-0" />
              <span>Create "<strong>{query}</strong>"</span>
            </Button>

            <FileResultsList query={query} onOpen={onOpen} />
          </div>
        </div>
      </div>
    </div>
  )
}
