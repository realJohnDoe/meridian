import { useMemo, useCallback } from 'react'
import { useStore } from '../store'
import type { Occurrence, EditScope } from '../types'
import { occKind } from '../types'

import { expandWithMultiday } from '../model/expansion'
import { fmtISO } from '../model/dateUtils'
import { sameDay, addDays, sortOccs } from '../presentation'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import DaySection from './DaySection'
import OverdueSection from './OverdueSection'
import { useToday } from '../hooks/useToday'

const isOverdue = (o: Occurrence) => occKind(o) === 'task' && !o.metadata.done


interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

export default function AgendaView({ onOpen }: Props) {
  const today = useToday()
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  // Expand occurrences and group them by day — same window as buildAgenda().
  const groups = useMemo(() => {
    const from = addDays(today, -7)
    const to = addDays(today, 90)
    const allOccs = expandWithMultiday(items, roots, from, to)

    const result: Record<string, { date: Date; items: Occurrence[] }> = {}

    // Always seed today so goToday() can always find a section to scroll to.
    const todayKey = fmtISO(today)
    result[todayKey] = {
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
      items: [],
    }

    // Add each occurrence to its day group. Multiday events get a "(Day X of N)"
    // suffix so they render like regular occurrence cards on every covered day.
    allOccs.forEach(o => {
      const jsTime = o.metadata.jsTime
      if (!jsTime) return
      const k = fmtISO(jsTime)
      if (!result[k]) {
        result[k] = {
          date: new Date(jsTime.getFullYear(), jsTime.getMonth(), jsTime.getDate()),
          items: [],
        }
      }
      result[k].items.push(o)
    })

    return result
  }, [items, roots])

  // Stable references so DaySection's memo comparator isn't short-circuited
  // by new function identities on every AgendaView render.
  const handleToggleDone = useCallback((occ: Occurrence) => toggleOccDone(occ), [])
  const handleSwipeDelete = useCallback((occ: Occurrence) => beginSwipeDelete(occ), [])

  const todayKey = fmtISO(today)
  const sortedKeys = Object.keys(groups).sort()
  const pastKeys = sortedKeys.filter(k => k < todayKey)
  const currentKeys = sortedKeys.filter(k => k >= todayKey)
  const overdueItems = sortOccs(pastKeys.flatMap(k => groups[k].items.filter(isOverdue)))

  return (
    <div className="pb-24">
      {/* Past day sections — overdue tasks excluded; skip sections that become empty */}
      {pastKeys.map(k => {
        const items = sortOccs(groups[k].items.filter(o => !isOverdue(o)))
        if (!items.length) return null
        return (
          <DaySection
            key={k}
            dateKey={k}
            date={groups[k].date}
            isToday={false}
            isTomorrow={false}
            items={items}
            onOpen={onOpen}
            onToggleDone={handleToggleDone}
            onSwipeDelete={handleSwipeDelete}
          />
        )
      })}

      {/* Overdue — only rendered when non-empty */}
      {overdueItems.length > 0 && (
        <OverdueSection
          items={overdueItems}
          onOpen={onOpen}
          onToggleDone={handleToggleDone}
          onSwipeDelete={handleSwipeDelete}
        />
      )}

      {/* Today + future */}
      {currentKeys.map(k => {
        const g = groups[k]
        const isToday = sameDay(g.date, today)
        const isTomorrow = sameDay(g.date, addDays(today, 1))
        return (
          <DaySection
            key={k}
            dateKey={k}
            date={g.date}
            isToday={isToday}
            isTomorrow={isTomorrow}
            items={sortOccs(g.items)}
            onOpen={onOpen}
            onToggleDone={handleToggleDone}
            onSwipeDelete={handleSwipeDelete}
          />
        )
      })}
    </div>
  )
}
