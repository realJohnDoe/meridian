import { lazy, Suspense } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Search, Plus, X } from 'lucide-react'
import { Button } from './ui/button'
import { IconButton } from './primitives/icon-button'
import { Input } from './ui/input'
import { newEntryRoute } from '@/routes'
import { useOpenEntry } from '@/hooks'
import { useCurrentDate } from '@/calendar'
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

  const searchOpen = sq !== undefined
  const filterQuery = sq ?? ''

  function openSearch() {
    void navigate({ to: '.' as const, search: (prev: Record<string, unknown>) => ({ ...prev, sq: '' }) })
  }

  function setQuery(value: string) {
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
    <div className="shrink-0 relative z-30 pointer-events-none">
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
          -mb-px overlap hides the backdrop-blur seam. */}
      <div className="absolute inset-x-0 bottom-full -mb-px h-5 bg-gradient-to-b from-transparent to-background pointer-events-none" />

      <div className={cn('relative z-search-bar px-3.5 pt-3.5 pb-[max(14px,env(safe-area-inset-bottom))] flex flex-col gap-2', searchOpen ? 'bg-background' : 'bg-background/85 backdrop-blur-sm')}>
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
