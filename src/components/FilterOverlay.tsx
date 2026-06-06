import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'

import { expandRange, collectUndated } from '../model/expansion'
import { addDays, occState } from '../meridian'
import OccurrenceCard from './OccurrenceCard'

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0)

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase(), t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++
  return qi === q.length
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase()
  let score = 0, qi = 0, cons = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { qi++; cons++; score += cons } else { cons = 0 }
  }
  if (t.startsWith(q)) score += 100
  return score
}

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

export default function FilterOverlay({ query, onOpen, onCreate }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const results = useMemo(() => {
    if (!query) return []
    const from = addDays(TODAY, -7)
    const to   = addDays(TODAY, 90)
    // Undated items (tasks/notes saved without a date) fall outside the expandRange
    // window, so collect them separately to keep them findable here too.
    const occs = [...expandRange(items, roots, from, to), ...collectUndated(items, roots)]
    return occs
      .filter(o => fuzzyMatch(query, o.metadata.title))
      .map(o => ({ occ: o, score: fuzzyScore(query, o.metadata.title) }))
      .sort((a, b) => b.score - a.score || +(a.occ.metadata.jsTime ?? 0) - +(b.occ.metadata.jsTime ?? 0))
      .map(x => x.occ)
  }, [items, roots, query])

  if (!query) return null

  return (
    <div id="filterOverlay" className="filter-overlay">
      {/* "Create" row */}
      <div className="occ-create-row" onClick={() => onCreate(query)}>
        <Plus size={14} />
        <span>Create "<strong>{query}</strong>"</span>
      </div>

      {results.length === 0 && (
        <div className="empty-state">No matches</div>
      )}

      <div className="flex flex-col gap-1.5 px-2 pt-2">
        {results.map((o, i) => (
          <div
            key={`${o.fileSlug}-${o.date}`}
            style={{ animation: 'fadeUp .16s ease both', animationDelay: `${i * 0.025}s` }}
          >
            <OccurrenceCard
              occ={o}
              variant="compact"
              isDone={!!o.metadata.done}
              currentBarClass={occState(o)}
              onOpen={() => onOpen(o)}
              onToggleDone={() => {}}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
