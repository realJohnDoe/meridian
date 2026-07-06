import { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'
import { occKind } from '@/occView'

import { fmtISO } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import DaySection from './DaySection'
import OverdueSection from './OverdueSection'
import { useAgendaScrollRestore, useSaveAgendaScroll } from './useAgendaScrollRestore'
import { useToday, useCalendarFilter, useExpandWithMultiday } from '@/hooks'

const isOverdue = (o: Occurrence) => occKind(o) === 'task' && !o.metadata.done

// Size estimates for the virtualizer. Real sizes are measured after render
// (measureElement); accurate estimates just keep the scrollbar/scrollToIndex
// stable before a section has been measured. initialMeasurementsCache means
// returning users always get real sizes — estimates only matter on first visit.
//
// HEADER_H: DaySection header div — pt-3.5 (14) + pb-1.5 (6) + text-xs line (~20) ≈ 40px
// ROW_H:    OccurrenceCard min-h-[44px] + py-2 padding + OccurrenceRow mb-1.5 (6) ≈ 68px
// Update these if the header/card padding changes in DaySection.tsx / OccurrenceCard.tsx.
const HEADER_H = 40
const ROW_H = 68

type Section =
  | { kind: 'day'; key: string; dateKey: string; date: Date; isToday: boolean; isTomorrow: boolean; items: Occurrence[] }
  | { kind: 'overdue'; key: string; items: Occurrence[] }

function estimateSection(s: Section): number {
  return HEADER_H + s.items.length * ROW_H
}

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

export default function AgendaView({ onOpen }: Props) {
  const today = useToday()
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const scrollToTodayOnce = useStore(s => s.scrollToTodayOnce)

  const { filterOccs } = useCalendarFilter()

  const from = addDays(today, -365)
  const to = addDays(today, 90)
  const allOccs = filterOccs(useExpandWithMultiday(items, roots, from, to))

  // Group occurrences by day.
  const groups = useMemo(() => {
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
  }, [allOccs, today])

  // Flatten the groups into one ordered list of sections to virtualize:
  // past day-sections (overdue excluded, non-empty) → overdue → current days.
  const sections = useMemo<Section[]>(() => {
    const todayKey = fmtISO(today)
    const sortedKeys = Object.keys(groups).sort()
    const pastKeys = sortedKeys.filter(k => k < todayKey)
    const currentKeys = sortedKeys.filter(k => k >= todayKey)
    const overdueItems = sortOccs(pastKeys.flatMap(k => groups[k].items.filter(isOverdue)))

    const out: Section[] = []
    for (const k of pastKeys) {
      const dayItems = sortOccs(groups[k].items.filter(o => !isOverdue(o)))
      if (!dayItems.length) continue
      out.push({ kind: 'day', key: k, dateKey: k, date: groups[k].date, isToday: false, isTomorrow: false, items: dayItems })
    }
    if (overdueItems.length > 0) {
      out.push({ kind: 'overdue', key: '__overdue__', items: overdueItems })
    }
    for (const k of currentKeys) {
      const g = groups[k]
      out.push({
        kind: 'day', key: k, dateKey: k, date: g.date,
        isToday: sameDay(g.date, today),
        isTomorrow: sameDay(g.date, addDays(today, 1)),
        items: sortOccs(g.items),
      })
    }
    return out
  }, [groups, today])

  // Today's occurrences can flip event-past/event-future purely from the clock
  // advancing, with no store change to trigger a re-render. Re-sort just
  // today's (small) item list once a minute so time-based reordering/dimming
  // stays live — cheap, unlike re-sorting the whole (up to ~455-day) `sections`
  // list. `tick` is threaded down to DaySection/OccurrenceRow to also force a
  // repaint when the order doesn't change but styling still would (see
  // DaySection's propsAreEqual and OccurrenceRow's tick prop).
  const [nowTick, setNowTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])
  const todayKey = fmtISO(today)
  const todayItems = useMemo(
    () => sortOccs(groups[todayKey].items),
    // nowTick isn't read in the body — it's a timer-driven cache-buster, not a data dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, todayKey, nowTick],
  )

  // Stable references so DaySection's memo comparator isn't short-circuited
  // by new function identities on every AgendaView render.
  const handleToggleDone = useCallback((occ: Occurrence) => toggleOccDone(occ), [])
  const handleSwipeDelete = useCallback((occ: Occurrence) => beginSwipeDelete(occ), [])

  // AgendaView owns its scroll container (scRef below), so the virtualizer reads
  // its own ref. The ref attaches during the layout phase before the
  // virtualizer's internal layout effect runs, so it connects synchronously on
  // first mount. Restore the prior scroll position (offset + measured sizes)
  // unless we're about to scroll to today.
  const scRef = useRef<HTMLDivElement>(null)
  const { initialOffset, initialMeasurementsCache } = useAgendaScrollRestore(scrollToTodayOnce)

  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scRef.current,
    estimateSize: i => estimateSection(sections[i]),
    getItemKey: i => sections[i].key,
    overscan: 4,
    initialOffset,
    initialMeasurementsCache,
  })

  useSaveAgendaScroll(scRef, virtualizer)

  const virtualItems = virtualizer.getVirtualItems()

  // Feed the top-bar label: the date of the topmost visible day-section.
  // Derived from the virtualizer's range (platform-agnostic — works on mobile
  // where the old DOM scroll-query left the label stuck on "today").
  const lastTopRef = useRef<string | null>(null)
  useEffect(() => {
    if (!virtualItems.length) return
    const offset = virtualizer.scrollOffset ?? 0
    const top = virtualItems.find(vi => vi.end > offset + 12) ?? virtualItems[0]
    const s = sections[top.index]
    const key = s && s.kind === 'day' ? s.dateKey : fmtISO(today)
    if (key !== lastTopRef.current) {
      lastTopRef.current = key
      useStore.setState({ agendaTopDate: key })
    }
  }, [virtualItems, sections, today, virtualizer])

  // goToday: scroll to the overdue section (if any) else today. Off-screen
  // sections aren't in the DOM, so we use the virtualizer index rather than a
  // querySelector. The today section is always seeded, so an index exists.
  const goToIndex = useMemo(() => {
    const overdueIdx = sections.findIndex(s => s.kind === 'overdue')
    if (overdueIdx >= 0) return overdueIdx
    return sections.findIndex(s => s.kind === 'day' && s.isToday)
  }, [sections])

  useEffect(() => {
    if (!scrollToTodayOnce || goToIndex < 0 || !scRef.current) return
    virtualizer.scrollToIndex(goToIndex, { align: 'start' })
    lastTopRef.current = fmtISO(today)
    useStore.setState({ scrollToTodayOnce: false, agendaTopDate: fmtISO(today) })
  }, [scrollToTodayOnce, goToIndex, today, virtualizer])

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]" ref={scRef}>
      <div className="pb-24 lg:max-w-[720px] lg:mx-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualItems.map(vi => {
            const section = sections[vi.index]
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                {section.kind === 'overdue' ? (
                  <OverdueSection
                    items={section.items}
                    onOpen={onOpen}
                    onToggleDone={handleToggleDone}
                    onSwipeDelete={handleSwipeDelete}
                  />
                ) : (
                  <DaySection
                    date={section.date}
                    isToday={section.isToday}
                    isTomorrow={section.isTomorrow}
                    items={section.isToday ? todayItems : section.items}
                    tick={section.isToday ? nowTick : 0}
                    onOpen={onOpen}
                    onToggleDone={handleToggleDone}
                    onSwipeDelete={handleSwipeDelete}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
