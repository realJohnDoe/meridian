import { useEffect, useRef } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import type { Occurrence } from '@/types'
import SearchResults from './SearchResults'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

/**
 * Mobile full-screen search layer: input pinned at the top (auto-focused so the
 * keyboard rises), results scrolling beneath. The top→down flow means the
 * keyboard occupies the bottom of the scroll region instead of fighting the
 * input — so input and results stay usable at the same time. md:hidden; desktop
 * uses the FilterOverlay popover instead.
 */
export default function MobileSearchOverlay({ open, query, onQueryChange, onClose, onOpen, onCreate }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input whenever the layer opens so the keyboard comes up immediately.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-background pointer-events-auto">
      {/* Top input row — pinned, always visible */}
      <div className="shrink-0 flex items-center gap-2 px-3.5 pt-[max(14px,env(safe-area-inset-top))] pb-3.5 border-b border-border">
        <Button
          variant="ghost"
          size="icon"
          className="w-9 h-9 rounded-full shrink-0 text-muted-foreground"
          aria-label="Close search"
          onClick={onClose}
        >
          <ArrowLeft size={18} />
        </Button>
        <div className="search-bar-wrap min-w-0" style={{ flex: '1 1 0%' }}>
          <Search size={15} className="shrink-0 stroke-muted-foreground fill-none" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-foreground text-sm min-w-0 placeholder:text-muted-foreground"
            placeholder="Search or create…"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && query) onCreate(query)
            }}
          />
          {query && (
            <Button variant="ghost" size="icon" className="w-7 h-7 rounded-full shrink-0 text-muted-foreground" aria-label="Clear search" onClick={() => onQueryChange('')}>
              <X size={13} />
            </Button>
          )}
        </div>
      </div>

      {/* Results — scroll region; keyboard sits below this */}
      <div className="flex-1 min-h-0 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} />
      </div>
    </div>
  )
}
