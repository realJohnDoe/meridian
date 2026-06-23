import { Plus } from 'lucide-react'
import { useStore } from '@/store'
import type { Occurrence } from '@/types'
import FileResultsList from './FileResultsList'
import { Button } from '@/components/ui/button'

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

export default function FilterOverlay({ query, onOpen, onCreate }: Props) {
  const items = useStore(s => s.items)

  if (!query) return null

  return (
    <div id="filterOverlay" className="absolute bottom-full left-0 right-0 bg-background z-[25] overflow-y-auto [-webkit-overflow-scrolling:touch] pointer-events-auto max-h-[calc(100svh-var(--th)-80px)]">
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

        <FileResultsList query={query} items={items} onOpen={onOpen} />
      </div>
    </div>
  )
}
