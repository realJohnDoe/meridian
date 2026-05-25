import { useMemo } from 'react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import { expandRange } from '../recurrence'
import {
  sameDay, addDays, dayKey, sortOccs,
  toggleOccDone, swipeDeleteOcc,
} from '../meridian'
import DaySection from './DaySection'
import { TODAY } from '../constants'

interface Props {
  onOpen: (occ: Occurrence, scope?: string) => void
}

export default function AgendaView({ onOpen }: Props) {
  const nodes = useStore(s => s.nodes)

  // Expand occurrences and group them by day — same window as buildAgenda().
  const groups = useMemo(() => {
    const from = addDays(TODAY, -7)
    const to = addDays(TODAY, 90)
    const occs = expandRange(nodes, from, to) as Occurrence[]

    const result: Record<string, { date: Date; items: Occurrence[] }> = {}

    // Always seed today so goToday() can always find a section to scroll to.
    const todayKey = dayKey(TODAY)
    result[todayKey] = {
      date: new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()),
      items: [],
    }

    // First pass: add each occurrence to its day group.
    // Multiday events that are NOT on their start date are skipped; they'll
    // appear only once (on the start date) as a banner.
    occs.forEach(o => {
      if (o.multiday && !sameDay(o.jsTime, new Date(o.multiday.start))) return
      const k = dayKey(o.jsTime)
      if (!result[k]) {
        result[k] = {
          date: new Date(o.jsTime.getFullYear(), o.jsTime.getMonth(), o.jsTime.getDate()),
          items: [],
        }
      }
      result[k].items.push(o)
    })

    // Second pass: ensure every multiday event has at least one banner on its
    // start date even if the start-date occurrence was filtered out above.
    occs.filter(o => o.multiday).forEach(o => {
      const k = dayKey(new Date(o.multiday!.start))
      if (!result[k]) result[k] = { date: new Date(o.multiday!.start), items: [] }
      if (!result[k].items.find(x => x._nodeId === o._nodeId && x.multiday)) {
        result[k].items.push({ ...o, _isBanner: true })
      }
    })

    return result
  }, [nodes])

  function handleToggleDone(occ: Occurrence) {
    toggleOccDone(occ)
  }

  function handleSwipeDelete(occ: Occurrence) {
    swipeDeleteOcc(occ)
  }

  return (
    <div className="ag-pad">
      {Object.keys(groups).sort().map(k => {
        const g = groups[k]
        const isToday = sameDay(g.date, TODAY)
        const isTomorrow = sameDay(g.date, addDays(TODAY, 1))

        // Collect deduplicated multiday banners for this day.
        const mdSeen = new Set<string>()
        const multidayBanners: Occurrence[] = []
        g.items.filter(o => o.multiday).forEach(o => {
          if (!mdSeen.has(o._nodeId)) {
            mdSeen.add(o._nodeId)
            multidayBanners.push(o)
          }
        })

        // Non-multiday items, sorted (sortOccs mutates in place and returns).
        const nonMdItems = sortOccs([...g.items.filter(o => !o.multiday)]) as Occurrence[]

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
