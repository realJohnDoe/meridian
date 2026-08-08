import { useLayoutEffect } from 'react'
import type { Virtualizer, VirtualItem } from '@tanstack/react-virtual'
import { calendarView } from './viewState'
import { estimateRow, type AgendaRow } from './agendaSections'

type AgendaVirtualizer = Virtualizer<HTMLDivElement, Element>

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
