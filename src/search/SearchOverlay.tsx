import { useEffect, useRef } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import type { Occurrence } from '@/types'
import SearchResults from './SearchResults'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSidebar } from '@/components/ui/sidebar'

interface Props {
  open: boolean
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

/**
 * Search overlay, in one of two shapes depending on the *same* isMobile flag
 * the sidebar uses (from useSidebar), so the two can never disagree on which
 * layout a device gets the way the old width- vs pointer-based split did:
 *
 * - Mobile/tablet: full-screen layer, input pinned at the top (auto-focused
 *   so the keyboard rises), results scrolling beneath, back button to close.
 * - Desktop: popover floating above the search bar, with a backdrop that
 *   only covers the content area to the right of the sidebar (offset by
 *   --sidebar-width when the sidebar is expanded) rather than the sidebar
 *   itself.
 */
export default function SearchOverlay({ open, query, onQueryChange, onClose, onOpen, onCreate }: Props) {
  const { isMobile, open: sidebarOpen } = useSidebar()
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input whenever the mobile layer opens so the keyboard comes up immediately.
  useEffect(() => {
    if (open && isMobile) inputRef.current?.focus()
  }, [open, isMobile])

  if (isMobile) {
    if (!open) return null

    return (
      <div className="mobile-search-overlay fixed inset-0 z-50 flex flex-col bg-background pointer-events-auto">
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
            <Input
              ref={inputRef}
              variant="ghost"
              className="flex-1 min-w-0"
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

  if (!query) return null

  return (
    <>
      {/* Backdrop: covers the content area behind the popover, not the sidebar */}
      <div
        className={`fixed inset-y-0 right-0 z-[24] bg-background/80 backdrop-blur-sm pointer-events-auto transition-[left] duration-200 ease-linear ${sidebarOpen ? 'left-[var(--sidebar-width)]' : 'left-0'}`}
      />
      <div id="filterOverlay" className="absolute bottom-full left-0 right-0 z-[25] pointer-events-auto">
        <div className="relative max-h-[calc(100dvh-var(--th)-80px)] flex flex-col">
          <div className="overflow-y-auto [-webkit-overflow-scrolling:touch] bg-background flex-1 min-h-0">
            <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} />
          </div>
        </div>
      </div>
    </>
  )
}
