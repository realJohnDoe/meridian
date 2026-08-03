import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import type { Occurrence } from '@/types'
import SearchResults from './SearchResults'
import { IconButton } from '@/components/primitives/icon-button'
import { Input } from '@/components/ui/input'
import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/cn'

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
  const mobileScrollRef = useRef<HTMLDivElement>(null)
  const desktopScrollRef = useRef<HTMLDivElement>(null)
  // Drives the pinned top row's scroll shadow once results scroll beneath it.
  // Reset whenever the overlay reopens (the dialog's DOM — and its scrollTop —
  // was torn down while closed, so a stale `true` from the prior session would
  // otherwise show a shadow before the first scroll event corrects it).
  // Adjusting state during render, not in an effect, per React's "resetting
  // state when a prop changes" pattern — avoids an extra render pass.
  const [resultsScrolled, setResultsScrolled] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setResultsScrolled(false)
  }

  // Focus the input whenever the mobile layer opens so the keyboard comes up immediately.
  useEffect(() => {
    if (open && isMobile) inputRef.current?.focus()
  }, [open, isMobile])

  // Desktop renders nothing until there's a query (see the early return below),
  // so the overlay is only actually on screen in these two cases.
  const showing = isMobile ? open : open && !!query

  // Escape closes the overlay. This is a document-level listener mounted only
  // while the overlay is showing — not a handler on the layer itself — because
  // focus can sit outside this component's tree: on desktop the search input
  // lives in components/SearchBar.tsx, above the overlay. Same shape as the
  // dismissal effect in hooks/use-floating-combobox.ts.
  useEffect(() => {
    if (!showing) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showing, onClose])

  if (isMobile) {
    if (!open) return null

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="mobile-search-overlay fixed inset-0 z-50 flex flex-col bg-background pointer-events-auto"
      >
        {/* Top input row — pinned, always visible */}
        <div className={cn('shrink-0 flex items-center gap-2 px-3.5 pt-[max(14px,env(safe-area-inset-top))] pb-3.5 border-b border-border transition-shadow', resultsScrolled && 'shadow-md')}>
          <IconButton
            variant="ghost"
            className="w-9 h-9 text-muted-foreground"
            label="Close search"
            onClick={onClose}
          >
            <ArrowLeft size={18} />
          </IconButton>
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
              <IconButton variant="ghost" hit="pad" className="w-7 h-7 text-muted-foreground" label="Clear search" onClick={() => onQueryChange('')}>
                <X size={13} />
              </IconButton>
            )}
          </div>
        </div>

        {/* Results — scroll region; keyboard sits below this */}
        <div
          ref={mobileScrollRef}
          className="flex-1 min-h-0 overflow-y-auto [-webkit-overflow-scrolling:touch]"
          onScroll={e => setResultsScrolled(e.currentTarget.scrollTop > 0)}
        >
          <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} scrollRef={mobileScrollRef} />
        </div>
      </div>
    )
  }

  if (!query) return null

  return (
    <>
      {/* Backdrop: covers the content area behind the popover, not the sidebar.
          A <button> rather than a <div> so click-to-dismiss is reachable by
          keyboard and screen readers instead of being a dead click target. */}
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className={cn('fixed inset-y-0 right-0 z-search-backdrop bg-background/80 backdrop-blur-sm pointer-events-auto transition-[left] duration-200 ease-linear', sidebarOpen ? 'left-[var(--sidebar-width)]' : 'left-0')}
      />
      <div id="filterOverlay" className="absolute bottom-full left-0 right-0 z-search-panel pointer-events-auto">
        <div className="relative max-h-[calc(100dvh-var(--th)-80px)] flex flex-col">
          <div ref={desktopScrollRef} className="overflow-y-auto [-webkit-overflow-scrolling:touch] bg-background flex-1 min-h-0">
            <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} scrollRef={desktopScrollRef} />
          </div>
        </div>
      </div>
    </>
  )
}
