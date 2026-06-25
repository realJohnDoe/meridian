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
    <div id="filterOverlay" className="fixed bottom-[80px] left-0 right-0 md:absolute md:bottom-full md:left-0 md:right-0 z-[25] pointer-events-auto backdrop-blur-sm">
      {/* Top fade: blurred backdrop shows through, dissolves into the frosted surface below */}
      <div className="h-8 bg-gradient-to-b from-transparent to-background/85 pointer-events-none" />
      {/* Frosted content surface — matches the SearchBar's own bg-background/85 treatment */}
      <div className="bg-background/85 overflow-y-auto [-webkit-overflow-scrolling:touch] max-h-[calc(100dvh-var(--th)-112px)]">
        <div className="lg:max-w-[720px] lg:mx-auto pb-10">
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
  )
}
