import { useCallback, useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Occurrence, EditScope } from '@/types'

import { fmtISO } from '@/model'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import AgendaHeaderRow from './AgendaHeaderRow'
import OccurrenceRow from './OccurrenceRow'
import { useAgendaScrollRestore, useSaveAgendaScroll } from './useAgendaScrollRestore'
import { useAgendaSections, estimateRow } from './useAgendaSections'
import { useVirtualFlip, FLIP_KEY_ATTR } from './useVirtualFlip'
import { useToday } from '@/hooks'
import { useNow } from './useNow'
import { useScrollToTodayOnce, setAgendaTopDate, markScrolledToToday, setTopbarShadow } from './viewState'

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

export default function AgendaView({ onOpen }: Props) {
  'use no memo' // TanStack Virtual's useVirtualizer() reads mutable internal
  // state (scroll offset, measured sizes) through imperative methods rather
  // than props/state the compiler can track — react-hooks/incompatible-library.
  // This component also drives a raw scroll listener off virtualizer.scrollOffset
  // directly (see updateTopDate below), which is exactly the pattern the rule
  // warns about. Opting out here only affects this function — OccurrenceRow,
  // useAgendaSections, and everything else still gets compiled/memoized normally.
  //
  // Note: the compiler already auto-skips memoizing this function because it
  // detects the incompatible library, so this directive doesn't change
  // compiled output or silence the lint warning — it just makes the opt-out
  // explicit and future-proofs against that auto-detection changing. The
  // eslint warning here is expected and permanent; see eslint.config.js.
  const today = useToday()
  const scrollToTodayOnce = useScrollToTodayOnce()

  // Today's occurrences (and any occurrence whose event-past/event-future
  // state is instant-sensitive, e.g. a cross-midnight timed duration) can
  // flip purely from the clock advancing, with no store change to trigger a
  // re-render — so useAgendaSections depends on this ticking value to stay
  // honestly sorted, at the cost of a full re-sort once a minute (measured
  // negligible even at ~455 sections; see occSort's decorate-sort-undecorate).
  const now = useNow(60_000)

  const { rows, goToRowIndex } = useAgendaSections(today, now)

  // OccurrenceRow is memoized with React's default shallow compare, so these
  // handlers are genuinely part of its props comparison: an unstable reference
  // here would re-render every mounted row on every AgendaView render.
  // (Before row virtualization, DaySection's custom comparator ignored them
  // entirely, so instability was silently absorbed instead — the failure mode
  // has inverted, but useCallback is required either way.)
  const handleToggleDone = useCallback((occ: Occurrence) => toggleOccDone(occ), [])
  const handleSwipeDelete = useCallback((occ: Occurrence) => beginSwipeDelete(occ), [])

  // AgendaView owns its scroll container (scRef below), so the virtualizer reads
  // its own ref. The ref attaches during the layout phase before the
  // virtualizer's internal layout effect runs, so it connects synchronously on
  // first mount. Restore the prior scroll position (offset + measured sizes)
  // unless we're about to scroll to today.
  const scRef = useRef<HTMLDivElement>(null)
  const { initialOffset, initialMeasurementsCache } = useAgendaScrollRestore(scrollToTodayOnce)

  // Counts *rows*, not sections. Section-granular virtualization mounted every
  // row a section owned the moment it entered the viewport, and the overdue
  // section pools every undone past task with no cap — on a large vault that
  // was thousands of OccurrenceRows (each with three touch listeners, two
  // store subscriptions and a backlink lookup) in one synchronous commit.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scRef.current,
    // `count` is rows.length, so the virtualizer only ever asks for i in range.
    estimateSize: i => estimateRow(rows[i]!),
    getItemKey: i => rows[i]!.key,
    overscan: 8,
    initialOffset,
    initialMeasurementsCache,
  })

  useSaveAgendaScroll(scRef, virtualizer)

  const virtualItems = virtualizer.getVirtualItems()

  // Glide rows between positions when the list's contents change (a task
  // completed, deleted, re-sorted). Keyed on `rows` identity, so scrolling
  // — which shifts `start` as unmeasured rows get measured — doesn't animate.
  useVirtualFlip(scRef, virtualItems, rows, virtualizer.isScrolling)

  // Feed the top-bar label: the date of the topmost visible row.
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
    setTopbarShadow(offset > 0)
    const top = items.find(vi => vi.end > offset + 12) ?? items[0]!  // items.length checked above
    // `?? fmtISO(today)` guards a stale `rows` capture: this listener closes
    // over the render's rows while the virtualizer's items may be newer.
    // Overdue rows carry todayKey (see agendaSections.ts), so the label reads
    // "Today" over that block without a special case here.
    const key = rows[top.index]?.dateKey ?? fmtISO(today)
    if (key === lastTopRef.current) return
    lastTopRef.current = key
    setAgendaTopDate(key)
  }, [rows, today, virtualizer])

  useEffect(() => {
    const el = scRef.current
    if (!el) return
    el.addEventListener('scroll', updateTopDate, { passive: true })
    return () => el.removeEventListener('scroll', updateTopDate)
  }, [updateTopDate])

  // Clear the shared topbar shadow flag on unmount so a lingering "scrolled"
  // value from this view doesn't flash on the next view sharing #mainTop.
  useEffect(() => () => setTopbarShadow(false), [])

  // Covers what the scroll listener can't: the initial label on mount, and
  // keeping it correct if `today` flips at midnight (a PWA left open
  // overnight) or the top row shifts without a scroll (content edited).
  useEffect(() => {
    updateTopDate()
  }, [updateTopDate])

  useEffect(() => {
    if (!scrollToTodayOnce || goToRowIndex < 0 || !scRef.current) return
    virtualizer.scrollToIndex(goToRowIndex, { align: 'start' })
    lastTopRef.current = fmtISO(today)
    markScrolledToToday(fmtISO(today))
  }, [scrollToTodayOnce, goToRowIndex, today, virtualizer])

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]" ref={scRef}>
      <div className="pb-24 lg:max-w-3xl lg:mx-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualItems.map(vi => {
            // Same-render read: virtualItems came from this render's `rows`
            // (count === rows.length), so vi.index is in range. The scroll
            // listener above can't assume that — it reads a captured `rows`.
            const row = rows[vi.index]!
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                {/* useVirtualFlip animates this inner element, never the
                    positioned one above: a WAAPI animation outranks inline
                    style, so gliding the outer div would override the
                    virtualizer's own translateY and stack every row at the
                    top of the list. */}
                <div {...{ [FLIP_KEY_ATTR]: vi.key }}>
                  {row.kind === 'header' ? (
                    <AgendaHeaderRow label={row.label} tone={row.tone} />
                  ) : (
                    <OccurrenceRow
                      occ={row.occ}
                      // Only today's rows track the clock; every other row's
                      // event-past/event-future state can't change from the
                      // clock alone, and passing `now` would re-render them all
                      // once a minute for nothing.
                      now={row.isToday ? now : undefined}
                      showDate={row.showDate}
                      onOpen={onOpen}
                      onToggleDone={handleToggleDone}
                      onSwipeDelete={handleSwipeDelete}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
