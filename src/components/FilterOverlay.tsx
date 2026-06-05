import { Plus } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import FileResultsList from './FileResultsList'

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

export default function FilterOverlay({ query, onOpen, onCreate }: Props) {
  const items = useStore(s => s.items)

  if (!query) return null

  return (
    <div id="filterOverlay" className="filter-overlay">
      {/* "Create" row */}
      <div className="occ-create-row" onClick={() => onCreate(query)}>
        <Plus size={14} />
        <span>Create "<strong>{query}</strong>"</span>
      </div>

      <FileResultsList query={query} items={items} onOpen={onOpen} />
    </div>
  )
}
