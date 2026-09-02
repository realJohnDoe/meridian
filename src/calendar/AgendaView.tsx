import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Occurrence, EditScope } from '@/types'

import { parseDateString } from '@/model'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import { VirtualRows } from '@/components/primitives/virtual-rows'
import AgendaHeaderRow from './AgendaHeaderRow'
import AgendaDividerRow from './AgendaDividerRow'
import AgendaEmptyDayRow from './AgendaEmptyDayRow'
import AgendaRow from './AgendaRow'
import AgendaOverdueGroupRow from './AgendaOverdueGroupRow'
import AgendaLoadEarlierRow from './AgendaLoadEarlierRow'
import { computeAgendaScrollRestore, useSaveAgendaScroll, useAnchoredAgendaScroll, offsetOfRow } from './computeAgendaScrollRestore'
import { useAgendaSections, estimateRow } from './useAgendaSections'
import { useVirtualFlip, FLIP_KEY_ATTR } from './useVirtualFlip'
import { useScrollabilityWarning } from './agendaScrollability'
import { useToday } from '@/hooks'
import { useNow } from './useNow'
import { minLoadableChunk, maxLoadableChunk } from './agendaChunks'
import { useCalendarWeekStartsOn } from './calendarLocale'
import {
  calendarView,
  useAgendaAnchor, useAgendaScrollTarget, setAgendaTopDate, markAgendaScrolled, toggleOverdueCollapsed,
  useAgendaLoadedChunks, growAgendaLoadedChunksForward, growAgendaLoadedChunksBackward,
} from './viewState'

// How close to the end of the loaded rows a scroll must come before it bumps
// the run forward by a chunk — "~1 viewport" in row-count terms, generous
// enough that overscan (8) and the newly-appended chunk's own rows land ahead
// of the user reaching the true end.
const GROW_FORWARD_ROWS = 12

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

export default function AgendaView({ onOpen }: Props) {
  'use no memo' // TanStack Virtual's useVirtualizer() reads mutable internal
  // state (scroll offset, measured sizes) through imperative methods rather
  // than props/state the compiler can track — react-hooks/incompatible-library.
  // This component also drives a raw scroll listener off virtualizer.scrollOffset
  // directly (see updateTopDate below), which is exactly the pattern the rule
  // warns about. Opting out here only affects this function — AgendaRow,
  // useAgendaSections, and everything else still gets compiled/memoized normally.
  //
  // Note: the compiler already auto-skips memoizing this function because it
  // detects the incompatible library, so this directive doesn't change
  // compiled output — it just makes the opt-out explicit and future-proofs
  // against that auto-detection changing. The eslint warning itself is
  // silenced at its source below (see the disable comment on useVirtualizer).
  const today = useToday()
  // agendaAnchor centers the loaded run (see viewState.ts) — normally today,
  // but re-centered by a jump from Month/Day via the sidebar (a day outside
  // the loaded run otherwise wouldn't have a row at all).
  const anchorKey = useAgendaAnchor()
  const anchor = useMemo(() => parseDateString(anchorKey) ?? today, [anchorKey, today])
  const scrollTarget = useAgendaScrollTarget()
  const ws = useCalendarWeekStartsOn()

  // Today's occurrences (and any occurrence whose event-past/event-future
  // state is instant-sensitive, e.g. a cross-midnight timed duration) can
  // flip purely from the clock advancing, with no store change to trigger a
  // re-render — so useAgendaSections depends on this ticking value to stay
  // honestly sorted, at the cost of a full re-sort once a minute (measured
  // negligible even at ~455 sections; see occSort's decorate-sort-undecorate).
  const now = useNow(60_000)

  const { rows, goToRowIndex } = useAgendaSections(today, now, anchor)

  // The loaded run's current bounds (seeded by useAgendaSections' own call to
  // useAgendaLoadedRun above, so this is never null once rows exist) and how
  // far growth may still take it in each direction — see agendaChunks.ts's
  // minLoadableChunk/maxLoadableChunk.
  const loadedChunks = useAgendaLoadedChunks()
  const minFirst = useMemo(() => minLoadableChunk(anchor, ws), [anchor, ws])
  const maxLast = useMemo(() => maxLoadableChunk(anchor, ws), [anchor, ws])
  const canLoadEarlier = loadedChunks !== null && loadedChunks.first > minFirst
  const handleLoadEarlier = useCallback(() => growAgendaLoadedChunksBackward(minFirst), [minFirst])

  // AgendaRow is memoized with React's default shallow compare, so these
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
  // first mount. Seed it with the prior scroll position (offset + measured
  // sizes), or with the target row's own offset when a scroll is pending — so
  // the first painted frame is already in the right place rather than at the
  // top of the list.
  const scRef = useRef<HTMLDivElement>(null)
  const { initialOffset, initialMeasurementsCache } = computeAgendaScrollRestore(scrollTarget !== null, rows, goToRowIndex)

  // Counts *rows*, not sections. Section-granular virtualization mounted every
  // row a section owned the moment it entered the viewport, and the overdue
  // section pools every undone past task with no cap — on a large vault that
  // was thousands of AgendaRows (each with three touch listeners, two
  // store subscriptions and a backlink lookup) in one synchronous commit.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer() returns functions the compiler can't memoize safely; it correctly skips optimizing this component instead.
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

  // Holds the day already on screen when `rows` is rebuilt by anything other
  // than a scroll — a vault's background sync landing, a filter toggle. See
  // the hook for why this corrects the offset rather than re-requesting a
  // scroll target.
  const { captureAnchor, anchorAt } = useAnchoredAgendaScroll(scRef, virtualizer, rows, scrollTarget !== null)

  const virtualItems = virtualizer.getVirtualItems()

  // Glide rows between positions when the list's contents change (a task
  // completed, deleted, re-sorted). Keyed on `rows` identity, so scrolling
  // — which shifts `start` as unmeasured rows get measured — doesn't animate.
  useVirtualFlip(scRef, virtualItems, rows, virtualizer.isScrolling)

  // Everything below — scrollToIndex, the seeded initial offset, the saved
  // offset, the scroll anchor — assumes scRef's element is the thing that
  // scrolls. When it isn't, all of them no-op silently against meaningless
  // numbers; see agendaScrollability.ts for why that assumption is stated here
  // rather than left implicit.
  useScrollabilityWarning(scRef, virtualizer.getTotalSize())

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
    const top = items.find(vi => vi.end > offset + 12) ?? items[0]!  // items.length checked above
    // `?? anchorKey` guards a stale `rows` capture: this listener closes over
    // the render's rows while the virtualizer's items may be newer. Overdue
    // rows carry todayKey (see agendaSections.ts), so the label reads "Today"
    // over that block without a special case here.
    const key = rows[top.index]?.dateKey ?? anchorKey
    if (key === lastTopRef.current) return
    lastTopRef.current = key
    setAgendaTopDate(key)
  }, [rows, anchorKey, virtualizer])

  // Forward growth: once the virtualizer's range comes within about a
  // viewport of the end of `rows`, widen the loaded run by one chunk. Reads
  // getVirtualItems() fresh rather than closing over `virtualItems`, same
  // reasoning as updateTopDate above.
  //
  // lastForwardGrowRef guards against asking twice for the same `rows` — the
  // scroll listener and the mount/refresh effect below both call this, and
  // once a request has been made (granted or not, see growAgendaLoadedChunksForward's
  // own maxLast bound) there is nothing more this row list can ask for.
  const lastForwardGrowRef = useRef<number>(-1)
  const maybeGrowForward = useCallback(() => {
    if (lastForwardGrowRef.current === rows.length) return
    const items = virtualizer.getVirtualItems()
    if (!items.length) return
    const endIndex = items[items.length - 1]!.index
    if (endIndex < rows.length - GROW_FORWARD_ROWS) return
    lastForwardGrowRef.current = rows.length
    growAgendaLoadedChunksForward(maxLast)
  }, [rows.length, maxLast, virtualizer])

  // A real scroll event is the authoritative moment to record where the
  // viewport is resting: virtualizer.scrollOffset is only current once the
  // browser has dispatched one, so capturing from a passive effect (which can
  // run before a programmatic scroll has been reflected) would bank a stale
  // position. Deliberately not folded into updateTopDate — that one also runs
  // from the mount/refresh effect below, where the offset isn't settled yet.
  const onScroll = useCallback(() => {
    updateTopDate()
    captureAnchor()
    maybeGrowForward()
  }, [updateTopDate, captureAnchor, maybeGrowForward])

  useEffect(() => {
    const el = scRef.current
    if (!el) return
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [onScroll])

  // Covers what the scroll listener can't: the initial label on mount, and
  // keeping it correct if `today` flips at midnight (a PWA left open
  // overnight) or the top row shifts without a scroll (content edited). Also
  // covers forward growth for a loaded run that doesn't fill the viewport in
  // the first place (a sparse vault) — this re-runs whenever `rows` changes,
  // including the rows change growth itself causes, so a still-too-short run
  // keeps widening until maybeGrowForward's own range check is satisfied or
  // growAgendaLoadedChunksForward's maxLast bound is reached.
  useEffect(() => {
    updateTopDate()
    maybeGrowForward()
  }, [updateTopDate, maybeGrowForward])

  // Layout, not passive: a passive effect runs *after* the browser has painted
  // the committed frame, so the scroll was a visible correction — the agenda
  // showed wherever the list happened to start, then jumped. Running it in the
  // layout phase keeps it in the same frame as the commit.
  //
  // On mount this is now only a correction: computeAgendaScrollRestore already
  // seeded the virtualizer at the target row, and this fixes up the residual
  // error between the estimated row sizes it summed and the real measured
  // ones. The case it still carries on its own is the Today button (or a
  // sidebar jump) pressed while the agenda is already mounted, where there is
  // no new mount and therefore no initialOffset to seed — and, more often in
  // practice, a quick-nav swipe committing while the agenda sits behind it.
  //
  // Seeds `scrollTop` directly with the same sum computeAgendaScrollRestore's
  // mount path already uses (offsetOfRow), rather than asking the virtualizer
  // to reach goToRowIndex via scrollToIndex. scrollToIndex on a target far
  // from the current position reconciles iteratively — scroll, measure,
  // correct, re-scroll — with no bound on how many corrective passes that
  // takes; a direct write is one scroll event plus, at most, the single
  // bounded correction below. Rendering the newly-visible rows themselves
  // (mounting them, the virtualizer measuring their real sizes) costs the
  // same either way — this only removes the *reconciliation* on top of it,
  // and the dependency on TanStack's internal machinery for something this
  // component can compute directly.
  useLayoutEffect(() => {
    if (!scrollTarget || goToRowIndex < 0 || !scRef.current) return
    scRef.current.scrollTop = offsetOfRow(rows, goToRowIndex, calendarView.getState().agendaScrollMeasurements)
    lastTopRef.current = scrollTarget
    // Record the landing spot directly rather than reading it back: the
    // scroll event this just triggered hasn't been dispatched yet, so
    // captureAnchor would still see the pre-scroll offset. This is also what
    // seeds the anchor on a cold start, before the user has scrolled at all —
    // which is exactly the case the startup drift showed up in.
    anchorAt(goToRowIndex, scrollTarget)
    markAgendaScrolled(scrollTarget)

    // The seeded offset is a sum of estimates where rows haven't been
    // measured yet, so the landing row can be off by one. One bounded
    // corrective pass, next frame: by then the scrollTop write above has
    // been reflected (a native scroll event, dispatched before the next
    // paint) and the virtualizer has re-measured against it, so a single
    // scrollToIndex call converges from a few pixels out instead of
    // reconciling from scratch — the same argument
    // computeAgendaScrollRestore's own doc makes for the mount path's own
    // residual-error correction. Deliberately not recursive and not re-armed
    // on a miss: one pass is enough once the seed is this close, and
    // anything more risks reintroducing the iterative cost this change
    // exists to avoid.
    const raf = requestAnimationFrame(() => {
      const items = virtualizer.getVirtualItems()
      if (!items.length) return
      const offset = virtualizer.scrollOffset ?? 0
      const top = items.find(vi => vi.end > offset + 12) ?? items[0]!  // length checked above
      if (top.index !== goToRowIndex) virtualizer.scrollToIndex(goToRowIndex, { align: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [scrollTarget, goToRowIndex, virtualizer, anchorAt, rows])

  // Only while the scroller sits at its very top does "Load earlier" belong
  // on screen — otherwise, sitting above the scroll container (see
  // AgendaLoadEarlierRow's own note), it would stay pinned in view no matter
  // how far down the list the user has scrolled. virtualizer.scrollOffset is
  // read directly rather than cached in state: this component already
  // re-renders on every scroll (virtualItems above reads it fresh each time),
  // so there's nothing to gain from a second copy.
  const atTop = (virtualizer.scrollOffset ?? 0) <= 0

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {canLoadEarlier && atTop && <AgendaLoadEarlierRow onClick={handleLoadEarlier} />}
      <div className="flex-1 min-h-0 overflow-y-auto [-webkit-overflow-scrolling:touch]" ref={scRef}>
        <VirtualRows
          className="pb-24 lg:max-w-3xl lg:mx-auto"
          virtualizer={virtualizer}
          rows={rows}
          renderRow={row => (
            // useVirtualFlip animates this inner element, never the positioned
            // one VirtualRows renders above: a WAAPI animation outranks inline
            // style, so gliding the outer div would override the virtualizer's
            // own translateY and stack every row at the top of the list.
            <div {...{ [FLIP_KEY_ATTR]: row.key }}>
              {row.kind === 'header' ? (
                <AgendaHeaderRow
                  label={row.label}
                  collapsed={row.collapsed}
                  count={row.count}
                  onToggle={toggleOverdueCollapsed}
                />
              ) : row.kind === 'month' || row.kind === 'week' ? (
                <AgendaDividerRow variant={row.kind} label={row.label} />
              ) : row.kind === 'day-empty' ? (
                <AgendaEmptyDayRow date={row.date} isToday={row.isToday} />
              ) : row.kind === 'overdue-group' ? (
                // No `now`: an overdue group's representative is an undone task,
                // whose styling can't change from the clock alone.
                <AgendaOverdueGroupRow
                  occ={row.occ}
                  count={row.count}
                  oldest={row.oldest}
                  onOpen={onOpen}
                  onToggleDone={handleToggleDone}
                />
              ) : (
                <AgendaRow
                  occ={row.occ}
                  // Only today's rows track the clock; every other row's
                  // event-past/event-future state can't change from the
                  // clock alone, and passing `now` would re-render them all
                  // once a minute for nothing.
                  now={row.isToday ? now : undefined}
                  showDate={row.showDate}
                  badge={row.badge ? { kind: 'day', ...row.badge } : { kind: 'spacer' }}
                  onOpen={onOpen}
                  onToggleDone={handleToggleDone}
                  onSwipeDelete={handleSwipeDelete}
                />
              )}
            </div>
          )}
        />
      </div>
    </div>
  )
}
