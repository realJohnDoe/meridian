import { useCallback, useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'

import { fmtISO } from '@/model'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import DaySection from './DaySection'
import OverdueSection from './OverdueSection'
import { useAgendaScrollRestore, useSaveAgendaScroll } from './useAgendaScrollRestore'
import { useAgendaSections, estimateSection } from './useAgendaSections'
import { useToday, useNow } from '@/hooks'

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

export default function AgendaView({ onOpen }: Props) {
  'use no memo' // TanStack Virtual's useVirtualizer() reads mutable internal
  // state (scroll offset, measured sizes) through imperative methods rather
  // than props/state the compiler can track — react-hooks/incompatible-library.
  // This component also drives a raw scroll listener off virtualizer.scrollOffset
  // directly (see updateTopDate below), which is exactly the pattern the rule
  // warns about. Opting out here only affects this function — DaySection,
  // useAgendaSections, and everything else still gets compiled/memoized normally.
  //
  // Note: the compiler already auto-skips memoizing this function because it
  // detects the incompatible library, so this directive doesn't change
  // compiled output or silence the lint warning — it just makes the opt-out
  // explicit and future-proofs against that auto-detection changing. The
  // eslint warning here is expected and permanent; see eslint.config.js.
  const today = useToday()
  const scrollToTodayOnce = useStore(s => s.scrollToTodayOnce)

  // Today's occurrences (and any occurrence whose event-past/event-future
  // state is instant-sensitive, e.g. a cross-midnight timed duration) can
  // flip purely from the clock advancing, with no store change to trigger a
  // re-render — so useAgendaSections depends on this ticking value to stay
  // honestly sorted, at the cost of a full re-sort once a minute (measured
  // negligible even at ~455 sections; see occSort's decorate-sort-undecorate).
  const now = useNow(60_000)

  const { sections, goToIndex } = useAgendaSections(today, now)

  // DaySection's propsAreEqual doesn't check these handler props at all (see
  // its own comment), so an unstable reference here wouldn't fail the memo —
  // it would just be silently ignored, leaving DaySection/OccurrenceRow bound
  // to whichever handler closure happened to be current when they last
  // re-rendered. useCallback keeps that closure correct across renders too.
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
  //
  // Reads virtualizer.scrollOffset/getVirtualItems() directly inside a raw
  // scroll listener rather than from the `virtualItems` returned by the last
  // render — that lagged the actual scroll position by a full render-hop,
  // stretched further under momentum (the same symptom traced on the month
  // carousel's swipe). The virtualizer updates those synchronously in its own
  // scroll handler, registered before this effect's listener (a layout effect
  // inside useVirtualizer runs before this passive effect in the same mount
  // commit), so by the time this listener runs on a later scroll event the
  // browser has already invoked the virtualizer's — same-target listeners
  // fire in registration order — and the values it reads are current.
  const lastTopRef = useRef<string | null>(null)
  const updateTopDate = useCallback(() => {
    const items = virtualizer.getVirtualItems()
    if (!items.length) return
    const offset = virtualizer.scrollOffset ?? 0
    const top = items.find(vi => vi.end > offset + 12) ?? items[0]
    const s = sections[top.index]
    const key = s && s.kind === 'day' ? s.dateKey : fmtISO(today)
    if (key === lastTopRef.current) return
    lastTopRef.current = key
    useStore.setState({ agendaTopDate: key })
  }, [sections, today, virtualizer])

  useEffect(() => {
    const el = scRef.current
    if (!el) return
    el.addEventListener('scroll', updateTopDate, { passive: true })
    return () => el.removeEventListener('scroll', updateTopDate)
  }, [updateTopDate])

  // Covers what the scroll listener can't: the initial label on mount, and
  // keeping it correct if `today` flips at midnight (a PWA left open
  // overnight) or the top section shifts without a scroll (content edited).
  useEffect(() => {
    updateTopDate()
  }, [updateTopDate])

  useEffect(() => {
    if (!scrollToTodayOnce || goToIndex < 0 || !scRef.current) return
    virtualizer.scrollToIndex(goToIndex, { align: 'start' })
    lastTopRef.current = fmtISO(today)
    useStore.setState({ scrollToTodayOnce: false, agendaTopDate: fmtISO(today) })
  }, [scrollToTodayOnce, goToIndex, today, virtualizer])

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]" ref={scRef}>
      <div className="pb-24 lg:max-w-3xl lg:mx-auto">
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
                    items={section.items}
                    now={section.isToday ? now : undefined}
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
