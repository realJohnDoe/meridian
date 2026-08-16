import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Virtualizer, VirtualItem } from '@tanstack/react-virtual'
import { calendarView } from './viewState'
import { estimateRow, type AgendaRow } from './agendaSections'

type AgendaVirtualizer = Virtualizer<HTMLDivElement, Element>

/**
 * How far below the scroll offset a row's bottom edge must sit to count as
 * "the top row" — a couple of pixels of the previous row peeking in doesn't
 * make it the one the viewport is resting on.
 */
const TOP_ROW_EPSILON = 12

/**
 * Where the virtualizer should start so that `goToRowIndex` is the top row:
 * the summed height of every row above it. Sizes come from the measurement
 * snapshot where it has one (a remount inside the session) and from
 * estimateRow otherwise (a cold start, where the snapshot is empty).
 *
 * Matching the snapshot by row *key* rather than index is what makes it safe
 * to reuse across a rebuild: `rows` may have grown or shrunk since the
 * snapshot was taken, but a key (`dateKey|id|instant`) still identifies the
 * same row — see occRows in agendaSections.ts.
 */
function offsetOfRow(rows: AgendaRow[], goToRowIndex: number, snapshot: VirtualItem[]): number {
  if (goToRowIndex <= 0) return 0
  const measured = snapshot.length > 0 ? new Map(snapshot.map(m => [m.key, m.size])) : null
  let offset = 0
  for (let i = 0; i < goToRowIndex && i < rows.length; i++) {
    const row = rows[i]!  // i < rows.length
    offset += measured?.get(row.key) ?? estimateRow(row)
  }
  return offset
}

/**
 * Returns the values to seed `useVirtualizer` with so a remount lands on the
 * right scroll position. Call **before** creating the virtualizer.
 *
 * Reads the store snapshot once via getState() rather than subscribing —
 * these values only ever matter as useVirtualizer's initial* options, which
 * it only honors on the very first render, so there's nothing for a
 * subscription to usefully re-render this component for.
 *
 * @param scrollToToday when true (scroll-to-today pending) the saved offset is
 *   ignored and the virtualizer starts at today's row instead.
 *
 * Seeding the offset rather than starting at 0 and scrolling afterwards is the
 * whole point. AgendaPage only mounts AgendaView once `items` is non-empty, so
 * `goToRowIndex` is already known on the very first render — and the
 * virtualizer applies `initialOffset` to the real element in its own mount
 * layout effect, before the browser paints. Starting at 0 meant the first
 * painted frame showed the oldest day in the window, and the correction that
 * followed cost a full unmount/remount of the viewport (traced at 66 ms,
 * flushed *synchronously* inside the scroll event because it runs from a
 * native listener) plus a round of TanStack's rAF scroll reconciliation. That
 * whole sequence was visible as the agenda sitting on the wrong day, ~160 ms
 * in the trace and unbounded on slower devices.
 *
 * The seed is still only an estimate on a cold start, so AgendaView keeps a
 * corrective scrollToIndex — but it now starts from a few pixels out instead
 * of a year.
 */
export function useAgendaScrollRestore(scrollToToday: boolean, rows: AgendaRow[], goToRowIndex: number): {
  initialOffset: number
  initialMeasurementsCache: VirtualItem[]
} {
  const { agendaScrollOffset, agendaScrollMeasurements } = calendarView.getState()
  return {
    initialOffset: scrollToToday
      ? offsetOfRow(rows, goToRowIndex, agendaScrollMeasurements)
      : agendaScrollOffset,
    initialMeasurementsCache: agendaScrollMeasurements,
  }
}

/**
 * The row the viewport was resting on, so a rebuilt `rows` can be re-pinned to
 * the same place.
 */
export interface ScrollAnchor {
  /** Key of the row at the top of the viewport (`dateKey|id|instant`). */
  key: string
  /** That row's day — the fallback when the row itself is gone. */
  dateKey: string
  /**
   * The row's index when it was captured. The correction fires only when this
   * changes: an index that survives a rebuild means nothing above the viewport
   * was added or removed, so there is nothing to correct. That test is what
   * makes the once-a-minute `now` tick free — it rebuilds `rows` wholesale
   * (see useAgendaSections) without moving anything, and re-pinning on every
   * tick would nudge a mid-row reading position once a minute forever.
   */
  index: number
}

/**
 * Where to re-pin the viewport in a rebuilt `rows`, given the row it was
 * resting on before the rebuild.
 *
 * Two levels of fallback, because a rebuild can remove the anchored row itself:
 *
 *  1. **Same row key** — the ordinary case (content landed somewhere else in
 *     the list).
 *  2. **Same day** — the anchored row is gone (its task was filtered out,
 *     completed, or deleted). Pin to the first row of that day instead. `rows`
 *     walks the window day by day, so `dateKey` is non-decreasing across it and
 *     a scan for the first `dateKey >= anchor.dateKey` finds that day (or the
 *     next surviving one, if the whole day went away).
 *
 * `-1` means neither matched — the anchor's day fell out of the window
 * entirely, and the caller should leave the scroll position alone rather than
 * guess.
 */
export function findAnchorIndex(rows: AgendaRow[], anchor: ScrollAnchor): number {
  const exact = rows.findIndex(r => r.key === anchor.key)
  if (exact >= 0) return exact
  return rows.findIndex(r => r.dateKey >= anchor.dateKey)
}

/**
 * Keeps the agenda on the day it is already showing when `rows` is rebuilt by
 * something *other* than the user scrolling.
 *
 * The virtualizer only ever tracks a raw scroll **pixel** offset. That is right
 * for a scroll, and wrong for everything else: when rows appear or disappear
 * above the viewport, the same pixel offset now lands on entirely different
 * content, and the agenda silently slides to another day. Two reports of this,
 * with the same root cause and different triggers:
 *
 *  - **"Opens on today, then jumps back in time a few seconds after."** A
 *    vault's background sync (`mergeChangedIntoStore`) replaces its layer once
 *    the GitHub round trips land. `loadVaultContent` deliberately does not
 *    await that sync when the cache already painted, so it completes well after
 *    `markAgendaScrolled` cleared `agendaScrollTarget` — nothing was left to
 *    re-assert the position. Synced-in past-dated tasks pool into the overdue
 *    section *above* the viewport, so the agenda slid backwards.
 *  - **"Changing the filter changes the scrolled-to day."** Hiding a vault, a
 *    participant or tasks drops a block of rows the same way.
 *
 * Re-pinning the row here rather than re-requesting a scroll target is what
 * keeps this cheap and unsurprising: `requestScrollToDate` would also re-center
 * `agendaAnchor`, rebuilding the whole ±window and flipping `preferOverdue`
 * (see agendaSections.ts) — a jump to a day, when all that was asked for is to
 * stay put.
 *
 * **Corrects by index, not by pixel offset.** The obvious implementation —
 * compute the anchor row's new `start` and `scrollToOffset` there — is wrong in
 * a way that only shows up once measurements settle: the rows that just landed
 * are unmeasured, so their `start` values are `estimateRow` guesses, and the
 * whole block compacts under the viewport as they mount and measure. Measured
 * against a real sync landing 60 overdue rows, a pixel-target correction
 * overshot by ~330px and settled a month past the anchored day.
 * `scrollToIndex` instead drives virtual-core's `reconcileScroll`, which
 * re-resolves the target *from the index* on every frame until it is stable —
 * the machinery built for exactly this estimate-to-actual drift, and what the
 * scroll-to-target effect already relies on.
 *
 * Returns `captureAnchor` (for the scroll listener — the authoritative moment,
 * since `virtualizer.scrollOffset` is only current after a real scroll event)
 * and `anchorAt` (for the scroll-to-target effect, which knows exactly where it
 * just landed without having to read it back).
 */
export function useAnchoredAgendaScroll(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  virtualizer: AgendaVirtualizer,
  rows: AgendaRow[],
  scrollTargetPending: boolean,
): { captureAnchor: () => void; anchorAt: (index: number, dateKey: string) => void } {
  const anchorRef = useRef<ScrollAnchor | null>(null)

  // Whether a finger is currently down on the list — the one state in which
  // re-pinning is the wrong move, because it would drag content out from under
  // an in-progress gesture.
  //
  // Deliberately *not* `virtualizer.isScrolling`, which was the first version
  // of this guard and the bug behind "GitHub alone is fine, but adding the
  // Tutorial or an iCal vault lands a month early". That flag is set by any
  // scroll, including the mount's own programmatic scrollToIndex, and only
  // clears on a 150ms debounce. A vault that needs no network — the
  // synthesized Tutorial vault, or one hydrating straight from Dexie — lands
  // its content well inside that window, so every startup correction was
  // skipped. Nothing rebuilds `rows` again afterwards, so the miss was
  // permanent rather than 150ms long. A GitHub vault's sync lands seconds
  // later, outside the window, which is why that one case looked fine.
  //
  // touch rather than pointer events: a touch-scroll fires `pointercancel` the
  // moment the browser takes the gesture over for scrolling, which would clear
  // the flag exactly when it is needed. Momentum after `touchend` is left
  // correctable on purpose — nothing is fighting the user then, and holding
  // the reading position beats letting content teleport under it.
  const touchingRef = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const down = () => { touchingRef.current = true }
    const up = () => { touchingRef.current = false }
    el.addEventListener('touchstart', down, { passive: true })
    // On the window, so a finger lifted outside the list still clears.
    window.addEventListener('touchend', up, { passive: true })
    window.addEventListener('touchcancel', up, { passive: true })
    return () => {
      el.removeEventListener('touchstart', down)
      window.removeEventListener('touchend', up)
      window.removeEventListener('touchcancel', up)
    }
  }, [scrollRef])

  const captureAnchor = useCallback(() => {
    const items = virtualizer.getVirtualItems()
    if (!items.length) return
    const offset = virtualizer.scrollOffset ?? 0
    const top = items.find(vi => vi.end > offset + TOP_ROW_EPSILON) ?? items[0]!  // length checked
    const row = rows[top.index]
    if (!row) return
    anchorRef.current = { key: row.key, dateKey: row.dateKey, index: top.index }
  }, [virtualizer, rows])

  const anchorAt = useCallback((index: number, dateKey: string) => {
    const row = rows[index]
    anchorRef.current = row ? { key: row.key, dateKey, index } : null
  }, [rows])

  // Seeded with the mount's own rows so the first run is a no-op — there is
  // nothing to correct before anything has changed, and the mount path is
  // already handled by useAgendaScrollRestore's seeded initialOffset.
  const prevRowsRef = useRef(rows)

  useLayoutEffect(() => {
    const prevRows = prevRowsRef.current
    prevRowsRef.current = rows
    if (prevRows === rows) return

    // An explicit jump (Today, a sidebar jump, a vault change) is already
    // being applied this commit and outranks holding the old position.
    if (scrollTargetPending) return

    const anchor = anchorRef.current
    if (!anchor) return

    // A finger is down: re-capture rather than correct, so the anchor tracks
    // where the user is dragging to and the next rebuild corrects from there
    // instead of from a position they have already left.
    if (touchingRef.current) { captureAnchor(); return }

    const index = findAnchorIndex(rows, anchor)
    if (index < 0) return
    // Same index means nothing above the viewport was added or removed, so
    // there is nothing to correct — and re-pinning anyway would snap a mid-row
    // position flush to the top on every rebuild, once a minute.
    if (index === anchor.index) return

    virtualizer.scrollToIndex(index, { align: 'start' })
    anchorRef.current = { ...anchor, index }
  }, [rows, scrollTargetPending, virtualizer, captureAnchor])

  return { captureAnchor, anchorAt }
}

/**
 * Snapshots the scroll offset and measured sizes on unmount so the next mount can
 * restore them. Call **after** creating the virtualizer (it needs the instance).
 */
export function useSaveAgendaScroll(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  virtualizer: AgendaVirtualizer,
): void {
  useLayoutEffect(() => () => {
    calendarView.setState({
      agendaScrollOffset: scrollRef.current?.scrollTop ?? calendarView.getState().agendaScrollOffset,
      agendaScrollMeasurements: virtualizer.takeSnapshot(),
    })
  }, [scrollRef, virtualizer])
}
