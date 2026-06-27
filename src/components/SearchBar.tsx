import { useState } from 'react'
import { Search, Plus, X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from './ui/button'
import { FilterOverlay, MobileSearchOverlay } from '@/search'
import { newEntryRoute } from '@/routes'
import { useOpenEntry } from '@/hooks'

export default function SearchBar() {
  const [filterQuery, setFilterQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const navigate = useNavigate()
  const openEntry = useOpenEntry()

  function handleOpen(occ: Parameters<typeof openEntry>[0]) {
    openEntry(occ)
    setFilterQuery('')
    setSearchOpen(false)
  }

  function handleCreate(title: string) {
    navigate(newEntryRoute(title))
    setFilterQuery('')
    setSearchOpen(false)
  }

  function handleClose() {
    setSearchOpen(false)
    setFilterQuery('')
  }

  return (
    <div className="shrink-0 relative z-30 pointer-events-none">
      {/* Mobile full-screen search overlay (md:hidden inside) */}
      <MobileSearchOverlay
        open={searchOpen}
        query={filterQuery}
        onQueryChange={setFilterQuery}
        onClose={handleClose}
        onOpen={handleOpen}
        onCreate={handleCreate}
      />

      {/* Gradient fade blending content into the sheet */}
      <div className="absolute inset-x-0 bottom-full h-10 bg-gradient-to-b from-transparent to-background/85 pointer-events-none" />

      {/* Desktop popover floats above the bar (hidden md:block inside FilterOverlay) */}
      <FilterOverlay
        query={filterQuery}
        onOpen={handleOpen}
        onCreate={handleCreate}
      />

      <div className="bg-background/85 backdrop-blur-sm px-3.5 py-3.5 flex flex-col gap-2">
        <div data-tour="search-bar" className="search-bar-wrap w-full max-w-[600px] mx-auto">
          <Search size={15} className="shrink-0 stroke-muted-foreground fill-none" />
          {/*
           * onFocus opens the mobile full-screen overlay (searchOpen only matters
           * on mobile; MobileSearchOverlay is md:hidden so desktop ignores it).
           * Desktop users type here directly; filterQuery drives FilterOverlay.
           */}
          <input
            id="filterInput"
            className="flex-1 bg-transparent border-none outline-none text-foreground text-sm min-w-0 placeholder:text-muted-foreground"
            placeholder="Search or create…"
            value={filterQuery}
            onFocus={() => setSearchOpen(true)}
            onChange={e => setFilterQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && filterQuery) {
                navigate(newEntryRoute(filterQuery))
                setFilterQuery('')
              }
            }}
          />
          {filterQuery && (
            <Button variant="ghost" size="icon" className="w-7 h-7 rounded-full shrink-0 text-muted-foreground" aria-label="Clear search" onClick={() => setFilterQuery('')}>
              <X size={13} />
            </Button>
          )}
          <Button
            variant="brand"
            size="icon"
            className="w-9 h-9 rounded-full shrink-0 hover:scale-[1.08] active:scale-[.93] [&_svg]:size-4"
            aria-label="New entry"
            onClick={() => {
              navigate(newEntryRoute(filterQuery))
              if (filterQuery) setFilterQuery('')
            }}
          ><Plus size={16} /></Button>
        </div>
      </div>
    </div>
  )
}
