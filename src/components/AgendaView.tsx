import { useMemo, useCallback } from 'react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import { isStandaloneOcc } from '../types'

import { expandRange, fmtISO, parseDurationDays, parseDateString } from '../model/expansion'
import {
  sameDay, addDays, sortOccs,
  toggleOccDone, beginSwipeDelete,
} from '../meridian'
import DaySection from './DaySection'
import { TODAY } from '../constants'


interface Props {
  onOpen: (occ: Occurrence, scope?: string) => void
}

export default function AgendaView({ onOpen }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  // Expand occurrences and group them by day — same window as buildAgenda().
  const groups = useMemo(() => {
    const from = addDays(TODAY, -7)
    const to = addDays(TODAY, 90)
    const occs = expandRange(items, roots, from, to)

    // Generate a virtual occurrence for each subsequent day that a multiday
    // event covers (day 1 is already in occs from expandRange).
    const extraMultiday = items
      .filter(isStandaloneOcc)
      .flatMap(i => {
        const days = parseDurationDays(i.metadata.duration)
        if (!days || days < 2) return []
        const startD = parseDateString(i.date)
        if (!startD) return []
        const extras: Occurrence[] = []
        for (let d = 1; d < days; d++) {
          const coveredDate = new Date(startD.getTime() + d * 86_400_000)
          if (coveredDate < from || coveredDate > to) continue
          extras.push({
            ...i,
            source: 'explicit' as const,
            metadata: {
              ...(roots.get(i.fileSlug) ?? { title: '', tags: [], topics: [] } as Record<string, unknown>),
              ...i.metadata,
              jsTime: coveredDate,
            } as Occurrence['metadata'],
          } as Occurrence)
        }
        return extras
      })

    const allOccs = [...occs, ...extraMultiday]

    const result: Record<string, { date: Date; items: Occurrence[] }> = {}

    // Always seed today so goToday() can always find a section to scroll to.
    const todayKey = fmtISO(TODAY)
    result[todayKey] = {
      date: new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()),
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

  return (
    <div className="ag-pad">
      {Object.keys(groups).sort().map(k => {
        const g = groups[k]
        const isToday = sameDay(g.date, TODAY)
        const isTomorrow = sameDay(g.date, addDays(TODAY, 1))

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
