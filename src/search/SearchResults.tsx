import { useEffect, useMemo, useState, type RefObject } from 'react'
import { Plus } from 'lucide-react'
import type { Occurrence } from '@/types'
import FileResultsList, { type FileSearchResult } from './FileResultsList'
import { cn } from '@/lib/cn'

/** One keyboard-navigable row: the Create row (entryKey null) or a result row. */
export interface SearchRow {
  id:       string
  entryKey: string | null
  activate: () => void
}

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
  /** Scroll container the results virtualizer measures against — owned by SearchOverlay. */
  scrollRef: RefObject<HTMLDivElement | null>
  /** Index into the combined Create+results row list that the keyboard currently highlights. */
  highlightedIndex?: number
  /**
   * Reports the combined row list and the index it defaults to (an exact,
   * case-insensitive title match if there is one, else the Create row) up to
   * the input that owns `highlightedIndex` — see -searchBar.tsx.
   */
  onRowsChange?: (rows: SearchRow[], defaultIndex: number) => void
}

/**
 * Shared results body for search: a "Create" row (only when there's a query)
 * followed by the file-granular results list. Used by both the desktop popover
 * (FilterOverlay) and the mobile full-screen layer (MobileSearchOverlay).
 */
export default function SearchResults(props: Props) {
  const { query, onOpen, onCreate, scrollRef, onRowsChange } = props
  const highlightedIndex = props.highlightedIndex ?? -1
  const [results, setResults] = useState<FileSearchResult[]>([])

  const rows = useMemo<SearchRow[]>(() => {
    const list: SearchRow[] = []
    if (query) list.push({ id: 'search-option-create', entryKey: null, activate: () => onCreate(query) })
    for (const r of results) list.push({ id: `search-option-${r.entry.entryKey}`, entryKey: r.entry.entryKey, activate: () => onOpen(r.occ) })
    return list
  }, [query, results, onCreate, onOpen])

  // Exact (case-insensitive) title match wins the default highlight; otherwise
  // it's the Create row — which is also what a phone's Enter key needs to hit
  // when there's no exact match, since there's no arrow key to move off it.
  const defaultIndex = useMemo(() => {
    if (!query) return 0
    const i = results.findIndex(r => r.entry.title.toLowerCase() === query.toLowerCase())
    return i >= 0 ? i + 1 : 0
  }, [query, results])

  // An effect, not an inline call during render: onRowsChange reaches into a
  // strict ancestor's state (-searchBar.tsx owns highlightedIndex), and
  // setting another component's state mid-render is the one thing React
  // doesn't tolerate from the "adjust state during render" pattern.
  useEffect(() => { onRowsChange?.(rows, defaultIndex) }, [rows, defaultIndex, onRowsChange])

  const highlighted = rows[highlightedIndex]

  return (
    <div className="lg:max-w-3xl lg:mx-auto" role="listbox" aria-label="Search results">
      {query && (
        <div className="px-3.5 pt-2">
          <button
            type="button"
            role="option"
            aria-selected={highlighted?.entryKey === null}
            id="search-option-create"
            className={cn(
              'flex w-full items-center gap-2.5 pl-3 pr-3.5 py-3.5 rounded-lg bg-primary/5 shadow-none cursor-pointer hover:bg-primary/10 transition-colors text-primary',
              highlighted?.entryKey === null && 'pointer-fine:ring-2 pointer-fine:ring-ring',
            )}
            onClick={() => onCreate(query)}
            aria-label={`Create "${query}"`}
          >
            <Plus size={16} className="shrink-0" />
            <span className="text-sm">Create "<strong>{query}</strong>"</span>
          </button>
        </div>
      )}

      <FileResultsList
        query={query}
        onOpen={onOpen}
        scrollRef={scrollRef}
        onResultsChange={setResults}
        highlightedEntryKey={highlighted?.entryKey ?? null}
      />
    </div>
  )
}
