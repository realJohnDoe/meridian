import { useEffect, useRef } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import type { Occurrence } from '@/types'
import SearchResults from './SearchResults'
import { IconButton } from '@/components/primitives/icon-button'
import { Input } from '@/components/ui/input'
import { useSidebar } from '@/components/ui/sidebar'
import { useFocusTrap } from '@/hooks'
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
 * - Desktop: panel pinned below the search bar, which SearchBar.tsx itself
 *   docks to the top of the screen for exactly this same condition — see
 *   its `dockTop` — replacing the main topbar for as long as search is
 *   open, rather than stacking below it (redundant) or leaving the bar at
 *   the bottom edge, where an on-screen keyboard (e.g. a landscape iPad,
 *   which hits this same breakpoint) would otherwise cover the bar it's
 *   meant to be typed into. A backdrop covers the content area to the
 *   right of the sidebar (offset by --sidebar-width when expanded) rather
 *   than the sidebar itself.
 */
export default function SearchOverlay({ open, query, onQueryChange, onClose, onOpen, onCreate }: Props) {
  const { isMobile, open: sidebarOpen } = useSidebar()
  const inputRef = useRef<HTMLInputElement>(null)
  const mobileLayerRef = useRef<HTMLDivElement>(null)
  const mobileScrollRef = useRef<HTMLDivElement>(null)
  const desktopScrollRef = useRef<HTMLDivElement>(null)

  // Mobile only: the layer covers the whole screen and says aria-modal, so Tab
  // has to stay inside it — otherwise the markup claims the app behind is
  // inert while the keyboard walks straight into it. `initialFocus` keeps the
  // old behaviour of focusing the input on open so the soft keyboard comes up
  // immediately. Focus is deliberately *not* restored on close: what held it
  // is SearchBar's own input (tapping it is what opens this layer), and
  // re-focusing that from the close tap would raise the keyboard again on a
  // screen the user just dismissed the keyboard from.
  //
  // The desktop branch is untrapped on purpose — its focus legitimately sits
  // outside this component's tree, in SearchBar's input above the panel (same
  // reason its Escape listener is document-level, below).
  useFocusTrap(mobileLayerRef, isMobile && open, { initialFocus: inputRef, restoreFocus: false })

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
        ref={mobileLayerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        tabIndex={-1}
        className="mobile-search-overlay outline-none fixed inset-0 z-50 flex flex-col bg-background pointer-events-auto"
      >
        {/* Top input row — pinned, always visible */}
        <div className="relative z-10 shrink-0 flex items-center gap-2 px-3.5 pt-[var(--search-top-inset)] pb-4 border-b border-border shadow-md">
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
        <div ref={mobileScrollRef} className="flex-1 min-h-0 overflow-y-auto [-webkit-overflow-scrolling:touch]">
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
      <div
        id="filterOverlay"
        className={cn(
          // top clears the top-docked search bar itself: its own internal
          // top padding (--search-top-inset, clearing the OS chrome) plus
          // the 52px search-bar-wrap and its own bottom padding
          // (--search-bottom-inset, 16px baseline) below it.
          'fixed top-[calc(var(--search-top-inset)+52px+var(--search-bottom-inset))] right-0 bottom-0 z-search-panel pointer-events-auto flex flex-col transition-[left] duration-200 ease-linear',
          sidebarOpen ? 'left-[var(--sidebar-width)]' : 'left-0',
        )}
      >
        <div ref={desktopScrollRef} className="overflow-y-auto [-webkit-overflow-scrolling:touch] bg-background flex-1 min-h-0">
          <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} scrollRef={desktopScrollRef} />
        </div>
      </div>
    </>
  )
}
