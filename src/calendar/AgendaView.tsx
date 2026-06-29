import { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { VirtualItem } from '@tanstack/react-virtual'
import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'
import { occKind } from '@/occView'

import { fmtISO, useExpandWithMultiday } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import DaySection from './DaySection'
import OverdueSection from './OverdueSection'
import { useToday, useParticipantFilter } from '@/hooks'

const isOverdue = (o: Occurrence) => occKind(o) === 'task' && !o.metadata.done

// Size estimates for the virtualizer. Real sizes are measured after render
// (measureElement); accurate estimates just keep the scrollbar/scrollToIndex
// stable before a section has been measured.
const HEADER_H = 40
const ROW_H = 68

type Section =
  | { kind: 'day'; key: string; dateKey: string; date: Date; isToday: boolean; isTomorrow: boolean; items: Occurrence[] }
  | { kind: 'overdue'; key: string; items: Occurrence[] }

function estimateSection(s: Section): number {
  return HEADER_H + s.items.length * ROW_H
}

// Measured section sizes from the previous mount, persisted module-level so a
// remount (navigating back to the agenda) seeds the virtualizer with real sizes
// instead of estimates. Without this the saved scroll offset maps to different
// content — the list drifts ~one section per round-trip — because off-screen
// sections are re-estimated rather than measured.
let savedMeasurements: VirtualItem[] = []

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  /** The scroll container that owns the agenda scroll (provided by AgendaPage). */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /**
   * Saved scroll offset from the previous mount (module-level in AgendaPage).
   * Passed here so the virtualizer can pre-position items before the first
   * paint, avoiding a blank frame when restoring scroll position.
   * Ignored when scrollToTodayOnce is true (we're going to scroll to today).
   */
  initialScrollOffset?: number
}

export default function AgendaView({ onOpen, scrollRef, initialScrollOffset = 0 }: Props) {
  const today = useToday()
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const scrollToTodayOnce = useStore(s => s.scrollToTodayOnce)

  const { filterOccs } = useParticipantFilter()

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

  // Stable references so DaySection's memo comparator isn't short-circuited
  // by new function identities on every AgendaView render.
  const handleToggleDone = useCallback((occ: Occurrence) => toggleOccDone(occ), [])
  const handleSwipeDelete = useCallback((occ: Occurrence) => beginSwipeDelete(occ), [])

  // The scroll container is owned by AgendaPage (the parent), so its ref is
  // attached only after this child's layout effects have already run (React
  // attaches refs and runs layout effects bottom-up). Reading scrollRef.current
  // from the virtualizer's internal layout effect therefore yields null, so the
  // virtualizer never connects unless an incidental re-render happens to re-run
  // it. On navigate-back nothing re-renders, leaving the agenda permanently
  // blank. Mirror the element into state from a passive effect — which runs
  // after every ref in the tree is attached — so the virtualizer connects
  // reliably on every mount.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => { setScrollEl(scrollRef.current) }, [scrollRef])

  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scrollEl,
    estimateSize: i => estimateSection(sections[i]),
    getItemKey: i => sections[i].key,
    overscan: 4,
    initialMeasurementsCache: savedMeasurements,
    // Pre-position virtual items so the first paint matches the restored
    // scrollTop set by AgendaPage's useLayoutEffect — without this the
    // virtualizer renders items at offset 0 while the DOM is already scrolled
    // to savedScrollTop, causing a blank frame on navigate-back.
    initialOffset: scrollToTodayOnce ? 0 : initialScrollOffset,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Snapshot measured section sizes on unmount so the next mount restores scroll
  // against real sizes (see savedMeasurements above).
  useEffect(() => () => { savedMeasurements = virtualizer.takeSnapshot() }, [virtualizer])

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
    // Wait until the virtualizer is connected to the scroll element (scrollEl
    // set) — scrollToIndex no-ops against a disconnected virtualizer (it reads
    // scrollElement to compute the offset and to schedule the reconcile), which
    // would consume the flag without ever scrolling to today.
    if (!scrollToTodayOnce || goToIndex < 0 || !scrollEl) return
    virtualizer.scrollToIndex(goToIndex, { align: 'start' })
    lastTopRef.current = fmtISO(today)
    useStore.setState({ scrollToTodayOnce: false, agendaTopDate: fmtISO(today) })
  }, [scrollToTodayOnce, goToIndex, today, virtualizer, scrollEl])

  return (
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
                  dateKey={section.dateKey}
                  date={section.date}
                  isToday={section.isToday}
                  isTomorrow={section.isTomorrow}
                  items={section.items}
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
  )
}
