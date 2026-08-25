// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DayPane from './DayPane'
import WeekPane from './WeekPane'
import { GUTTER, HOURS, HP, TOP_PAD, DEFAULT_SCROLL_HOUR } from './timelineGeometry'
import { weekStartFor } from './weekRange'
import { fmtISO } from '@/model'
import { setupStore, seedStore, makeRoots } from '@/test-utils'

setupStore()

// Both panes are rendered on *today* throughout: the now-line only exists on
// the pane showing today, and it is the piece whose geometry differs between
// the two views — see the NowLine assertions below.
const TODAY = new Date()
const DAY_KEY = fmtISO(TODAY)
// setupStore pins firstDayOfWeek to Monday.
const WEEK_KEY = fmtISO(weekStartFor(TODAY, 1))

const scrollerProps = {
  registerScroller: () => {},
  onVerticalScroll: () => {},
  getInitialScrollTop: () => 0,
}

function renderDay(overrides: Partial<Parameters<typeof DayPane>[0]> = {}) {
  seedStore([], makeRoots('note.md'))
  return render(<DayPane dateKey={DAY_KEY} onOpen={() => {}} {...scrollerProps} {...overrides} />)
}

function renderWeek(overrides: Partial<Parameters<typeof WeekPane>[0]> = {}) {
  seedStore([], makeRoots('note.md'))
  return render(
    <WeekPane weekStartKey={WEEK_KEY} onOpen={() => {}} onDayClick={() => {}} {...scrollerProps} {...overrides} />,
  )
}

// The scaffold DayPane and WeekPane share (timelineScaffold.tsx) was extracted
// from 46 byte-identical lines duplicated across the two files. These pin the
// two halves of that extraction: what must stay identical between the panes,
// and what must stay different — the latter being the part a careless
// normalization would quietly break.

describe('timeline scaffold — shared across both panes', () => {
  it('gives both panes the same hour-boundary labels', () => {
    const { container: dayEl, unmount } = renderDay()
    const dayLabels = [...dayEl.querySelectorAll('span.font-mono')].map(n => n.textContent)
    unmount()

    const { container: weekEl } = renderWeek()
    const weekLabels = [...weekEl.querySelectorAll('span.font-mono')].map(n => n.textContent)

    // 0:00 … 24:00 inclusive — a boundary label per hour plus the closing one.
    expect(dayLabels).toHaveLength(HOURS + 1)
    expect(dayLabels[0]).toBe('00:00')
    expect(dayLabels.at(-1)).toBe('24:00')
    expect(weekLabels).toEqual(dayLabels)
  })

  it('renders one hour cell per hour in the day view and per day-column hour in the week view', () => {
    const { unmount } = renderDay()
    expect(screen.getAllByRole('button', { name: /^Create event at / })).toHaveLength(HOURS)
    unmount()

    renderWeek()
    expect(screen.getAllByRole('button', { name: /^Create event on / })).toHaveLength(HOURS * 7)
  })

  it('positions each hour cell at its own hour on the timeline', () => {
    renderDay()
    const cells = screen.getAllByRole('button', { name: /^Create event at / })
    expect(cells[0]!.style.top).toBe(`${TOP_PAD + 1}px`)
    expect(cells[1]!.style.top).toBe(`${HP + TOP_PAD + 1}px`)
    expect(cells[0]!.style.height).toBe(`${HP - 2}px`)
  })

  it('creates at the hour boundary for keyboard activation, in each pane’s own date', () => {
    const onCreate = vi.fn()
    const { unmount } = renderDay({ onCreate })
    // A keyboard-activated click carries detail 0 — no pointer position to
    // read, so the new event lands at the top of the hour.
    screen.getByRole('button', { name: 'Create event at 09:00' }).click()
    expect(onCreate).toHaveBeenCalledWith(expect.any(Date), '09:00', '1h')
    expect(fmtISO(onCreate.mock.calls[0]![0] as Date)).toBe(DAY_KEY)
    unmount()

    const onCreateWeek = vi.fn()
    renderWeek({ onCreate: onCreateWeek })
    const mondayCells = screen.getAllByRole('button', { name: /^Create event on .* at 09:00$/ })
    mondayCells[0]!.click()
    expect(onCreateWeek).toHaveBeenCalledWith(expect.any(Date), '09:00', '1h')
    expect(fmtISO(onCreateWeek.mock.calls[0]![0] as Date)).toBe(WEEK_KEY)
  })

  it('seeds each pane’s scroller from the shared vertical offset on mount', () => {
    const sharedTop = DEFAULT_SCROLL_HOUR * HP + TOP_PAD
    const registered: HTMLDivElement[] = []
    renderDay({
      registerScroller: (_k, el) => { if (el) registered.push(el) },
      getInitialScrollTop: () => sharedTop,
    })
    expect(registered).toHaveLength(1)
    expect(registered[0]!.scrollTop).toBe(sharedTop)
  })
})

describe('timeline scaffold — the now-line span each pane needs', () => {
  it('runs the day view’s line from the label gutter to the pane edge', () => {
    // Hung off the pane's whole canvas, so it has to clear the hour-label
    // gutter itself. This inset used to be a hardcoded `left:64px` in
    // index.css shadowing GUTTER; it now comes from the constant.
    const { container } = renderDay()
    const line = container.querySelector<HTMLElement>('.now-line')
    expect(line).not.toBeNull()
    expect(line!.style.left).toBe(`${GUTTER}px`)
    expect(line!.style.right).toBe('0px')
  })

  it('scopes the week view’s line to today’s own day column', () => {
    // Rendered inside one day column, which already sits past the gutter — so
    // it spans that column fully rather than repeating the day view's inset.
    const { container } = renderWeek()
    const lines = container.querySelectorAll<HTMLElement>('.now-line')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.style.left).toBe('0px')
    expect(lines[0]!.style.right).toBe('0px')
  })

  it('puts both panes’ lines at the same vertical position for the same clock', () => {
    const { container: dayEl, unmount } = renderDay()
    const dayTop = dayEl.querySelector<HTMLElement>('.now-line')!.style.top
    unmount()

    const { container: weekEl } = renderWeek()
    expect(weekEl.querySelector<HTMLElement>('.now-line')!.style.top).toBe(dayTop)
  })
})
