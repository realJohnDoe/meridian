import { lazy, Suspense, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Search, Plus, X } from 'lucide-react'
import { Button } from './ui/button'
import { IconButton } from './primitives/icon-button'
import { Input } from './ui/input'
import { newEntryRoute } from '@/routes'
import { useOpenEntry } from '@/hooks'
import { useCurrentDate } from '@/calendar'
import { useSidebar } from './ui/sidebar'
import { cn } from '@/lib/cn'

// Lazy: SearchResults/FileResultsList pull in enough weight that they
// shouldn't sit on the agenda's cold-start critical path — deferred until
// search is actually opened.
const SearchOverlay = lazy(() => import('@/search').then(m => ({ default: m.SearchOverlay })))

export default function SearchBar() {
  // sq present (even as '') = search overlay open; sq value = current query.
  const { sq } = useSearch({ from: '/_app' })
  const navigate = useNavigate()
  const openEntry = useOpenEntry()
  const currentDate = useCurrentDate()
  const { isMobile, open: sidebarOpen } = useSidebar()

  const searchOpen = sq !== undefined
  const urlQuery = sq ?? ''

  // The input's displayed value is buffered in local state rather than read
  // straight from `sq`, because router search-param updates land through an
  // async transition. Deriving the controlled value from `sq` directly means
  // a keystroke's onChange fires, then — a tick later — the transition
  // commits and re-renders with a value that (briefly, mid-flight) doesn't
  // match what's already in the DOM, forcing a real value write that resets
  // the cursor to the end. Local state updates synchronously with the
  // keystroke, so the DOM value and cursor never get second-guessed.
  // `syncedUrlQuery` records which `sq` the local buffer was last derived
  // from, so a genuinely external change (opening, closing, browser
  // back/forward) is still picked up — this is React's "adjust state during
  // render" pattern, not an effect, so there's no extra tick where the two
  // could disagree.
  const [filterState, setFilterState] = useState(() => ({ query: urlQuery, syncedUrlQuery: urlQuery }))
  if (urlQuery !== filterState.syncedUrlQuery) {
    setFilterState({ query: urlQuery, syncedUrlQuery: urlQuery })
  }
  const filterQuery = filterState.query

  // Docked to the top of the screen — replacing the main topbar rather than
  // stacking below it — instead of at the screen's bottom edge, once the
  // results panel is showing (SearchOverlay's desktop branch renders under
  // this exact condition — see its `showing`) on non-mobile widths: an
  // on-screen keyboard — e.g. a landscape iPad, which hits this same
  // isMobile breakpoint — rises from the bottom and would otherwise cover
  // the very bar it's meant to be typed into. Keyed off the same isMobile
  // flag as the panel, not a separate touch check, so the two can't disagree.
  const dockTop = searchOpen && !isMobile && !!filterQuery

  function openSearch() {
    void navigate({ to: '.' as const, search: (prev: Record<string, unknown>) => ({ ...prev, sq: '' }) })
  }

  function setQuery(value: string) {
    setFilterState(prev => ({ query: value, syncedUrlQuery: prev.syncedUrlQuery }))
    // replace: true so typing doesn't spam the history stack
    void navigate({ to: '.' as const, search: (prev: Record<string, unknown>) => ({ ...prev, sq: value }), replace: true })
  }

  function closeSearch() {
    void navigate({ to: '.' as const, search: (prev: Record<string, unknown>) => ({ ...prev, sq: undefined }), replace: true })
  }

  function handleOpen(occ: Parameters<typeof openEntry>[0]) {
    // replace: true so the transient "search open" entry is overwritten
    // rather than left behind — back from the entry goes straight to the
    // pre-search page instead of reopening the overlay.
    void openEntry(occ, undefined, { replace: true })
  }

  function handleCreate(title: string) {
    void navigate({ ...newEntryRoute(title, { date: currentDate }), replace: true })
  }

  return (
    <div
      className={cn(
        'z-30 pointer-events-none',
        dockTop
          ? cn('fixed top-0 right-0 transition-[left] duration-200 ease-linear', sidebarOpen ? 'left-[var(--sidebar-width)]' : 'left-0')
          : 'shrink-0 relative',
      )}
    >
      {/* Full-screen layer on mobile/tablet, popover + scoped backdrop on desktop */}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchOverlay
            open={searchOpen}
            query={filterQuery}
            onQueryChange={setQuery}
            onClose={closeSearch}
            onOpen={handleOpen}
            onCreate={handleCreate}
          />
        </Suspense>
      )}

      {/* Gradient fade blending content into the sheet. Short fade (20px)
          that reaches full sheet opacity right at the sheet's top edge; the
          -mb-px overlap hides the backdrop-blur seam. Only makes sense
          docked at the bottom — nothing scrolls up behind a top-docked bar. */}
      {!dockTop && (
        <div className="absolute inset-x-0 bottom-full -mb-px h-5 bg-gradient-to-b from-transparent to-background pointer-events-none" />
      )}

      <div className={cn(
        'relative z-search-bar px-3.5 pb-[max(14px,env(safe-area-inset-bottom))] flex flex-col gap-2',
        // Docked: clear the OS chrome from the true top edge, same as the
        // mobile overlay's own row. Undocked: plain fixed spacing under
        // whatever sits above it (the app topbar handles its own inset).
        dockTop ? 'pt-[var(--search-top-inset)]' : 'pt-3.5',
        searchOpen ? 'bg-background' : 'bg-background/85 backdrop-blur-sm',
      )}>
        <div className="search-bar-wrap w-full max-w-xl mx-auto">
          <Search size={15} className="shrink-0 stroke-card-foreground fill-none" />
          {/*
           * Mobile: onClick opens the full-screen overlay (router push).
           * Desktop: typing directly updates sq via onChange (router replace).
           */}
          <Input
            id="filterInput"
            variant="ghost"
            className="flex-1 min-w-0 placeholder:text-card-foreground"
            placeholder="Search or create…"
            value={filterQuery}
            onClick={openSearch}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && filterQuery) handleCreate(filterQuery)
            }}
          />
          {filterQuery && (
            <IconButton variant="ghost" hit="pad" className="w-7 h-7 text-muted-foreground" label="Clear search" onClick={closeSearch}>
              <X size={13} />
            </IconButton>
          )}
          <Button
            variant="brand"
            size="icon"
            className="w-9 h-9 rounded-full shrink-0 hover:scale-[1.08] active:scale-[.93] [&_svg]:size-4"
            aria-label="New entry"
            onClick={() => navigate({ ...newEntryRoute(filterQuery || undefined, { date: currentDate }), replace: searchOpen })}
          ><Plus size={16} /></Button>
        </div>
      </div>
    </div>
  )
}
