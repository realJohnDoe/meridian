import { useMemo, useCallback } from 'react'
import { useStore } from '../store'
import type { Occurrence } from '../types'

import { expandRange, fmtISO } from '../model/expansion'
import { parseDurationDays } from '../model/expansion'
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

  // Expand occurrences and group them by day — same window as buildAgenda().
  const groups = useMemo(() => {
    const from = addDays(TODAY, -7)
    const to = addDays(TODAY, 90)
    const occs = expandRange(items, from, to)

    const result: Record<string, { date: Date; items: Occurrence[] }> = {}

    // Always seed today so goToday() can always find a section to scroll to.
    const todayKey = fmtISO(TODAY)
    result[todayKey] = {
      date: new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()),
      items: [],
    }

    // Add each occurrence to its day group. Multi-day events (duration ≥ 2d)
    // emit a single occurrence on their start date and appear as banners there.
    occs.forEach(o => {
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
  }, [items])

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

        // Separate multi-day events (shown as banners) from regular items.
        const isMultiday = (o: Occurrence) => (parseDurationDays(o.metadata.duration) ?? 0) >= 2
        const multidayBanners = g.items.filter(isMultiday)
        const nonMdItems = sortOccs(g.items.filter(o => !isMultiday(o)))

        return (
          <DaySection
            key={k}
            dateKey={k}
            date={g.date}
            isToday={isToday}
            isTomorrow={isTomorrow}
            multidayBanners={multidayBanners}
            items={nonMdItems}
            onOpen={onOpen}
            onToggleDone={handleToggleDone}
            onSwipeDelete={handleSwipeDelete}
          />
        )
      })}
    </div>
  )
}
