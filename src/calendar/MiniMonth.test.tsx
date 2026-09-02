// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import MiniMonth from './MiniMonth'
import { setupStore, seedStore, makeRoots, testKey } from '@/test-utils'
import { fmtISO } from '@/model'
import type { StoreOcc } from '@/types'

setupStore()

const ANCHOR = new Date(2026, 7, 15) // August 15 2026

function occ(id: string, date: string, metadata: Partial<StoreOcc['metadata']> = {}, overrides: Partial<StoreOcc> = {}): StoreOcc {
  return {
    id,
    date,
    time: '09:00',
    source: 'explicit',
    entryKey: testKey('note.md'),
    metadata: { participants: [], ...metadata },
    ...overrides,
  }
}

function dayButton(container: HTMLElement, date: Date): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`button[data-day="${fmtISO(date)}"]`)
  if (!el) throw new Error(`no day button rendered for ${date.toDateString()}`)
  return el
}

function renderMini(items: StoreOcc[], overrides: Partial<React.ComponentProps<typeof MiniMonth>> = {}) {
  seedStore(items, makeRoots('note.md'))
  const onSelectDay = vi.fn()
  const onBrowseMonth = vi.fn()
  const utils = render(
    <MiniMonth open anchorMonth={ANCHOR} highlightDates={[]} onSelectDay={onSelectDay} onBrowseMonth={onBrowseMonth} {...overrides} />,
  )
  return { ...utils, onSelectDay, onBrowseMonth }
}

describe('MiniMonth', () => {
  it("renders a dot, colored by the occurrence's category, on the day it falls on", () => {
    const { container } = renderMini([occ('a', '2026-08-15')])
    const dot = dayButton(container, new Date(2026, 7, 15)).querySelector('[data-dot="event"]')
    expect(dot).not.toBeNull()
    expect(dot).toHaveClass('bg-event')
  })

  it('renders a task dot colored by its priority', () => {
    const { container } = renderMini([occ('a', '2026-08-15', { done: false, priority: 'high' })])
    const dot = dayButton(container, new Date(2026, 7, 15)).querySelector('[data-dot="p1"]')
    expect(dot).not.toBeNull()
    expect(dot).toHaveClass('bg-priority-1')
  })

  it('renders no dot on a day with no occurrences', () => {
    const { container } = renderMini([occ('a', '2026-08-15')])
    expect(dayButton(container, new Date(2026, 7, 16)).querySelector('[data-dot]')).toBeNull()
  })

  it('highlights the day(s) in highlightDates with a primary tint ringed in primary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 10)) // not the highlighted day, so it can't also read as today
    try {
      const { container } = renderMini([], { highlightDates: [new Date(2026, 7, 15)] })
      expect(dayButton(container, new Date(2026, 7, 15))).toHaveClass('bg-primary/15', 'ring-2', 'ring-primary')
      // The tint, not today's solid fill — the two must stay distinguishable.
      expect(dayButton(container, new Date(2026, 7, 15))).not.toHaveClass('bg-primary')
      expect(dayButton(container, new Date(2026, 7, 16))).not.toHaveClass('ring-primary')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks today with the solid primary fill even when it is also the highlighted day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 15))
    try {
      const { container } = renderMini([], { highlightDates: [new Date(2026, 7, 15)] })
      expect(dayButton(container, new Date(2026, 7, 15))).toHaveClass('bg-primary')
      expect(dayButton(container, new Date(2026, 7, 15))).not.toHaveClass('bg-primary/15')
      expect(dayButton(container, new Date(2026, 7, 15))).not.toHaveClass('ring-primary')
    } finally {
      vi.useRealTimers()
    }
  })

  it("calls onSelectDay with the clicked day's ISO date", () => {
    const { container, onSelectDay } = renderMini([])
    fireEvent.click(dayButton(container, new Date(2026, 7, 20)))
    expect(onSelectDay).toHaveBeenCalledExactlyOnceWith('2026-08-20')
  })

  // Month paging now lives entirely in the MonthStrip row above the grid —
  // the grid's own caption/arrows are hidden (see MiniMonth's classNames)
  // precisely so the two controls can't duplicate each other.
  // Paging mounts a fresh pane — a new Calendar plus its own occurrence-
  // expansion computation (see MiniMonth's carousel) — which routinely takes
  // over a second even outside CI; the default 5s timeout is too tight under
  // CI contention, so these two get explicit headroom rather than a flaky retry.
  it("pages the grid's own month via the month-chip row, reporting it via onBrowseMonth rather than onSelectDay", () => {
    const { onSelectDay, onBrowseMonth } = renderMini([])
    expect(screen.getByRole('button', { name: 'August 2026' })).toHaveAttribute('aria-current', 'date')
    fireEvent.click(screen.getByRole('button', { name: 'September 2026' }))
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-current', 'date')
    expect(onSelectDay).not.toHaveBeenCalled()
    expect(onBrowseMonth).toHaveBeenCalledExactlyOnceWith(new Date(2026, 8, 1))
  }, 20000)

  it('re-syncs the browsed month to anchorMonth when the panel re-opens, not while it stays open', () => {
    function Host({ open }: { open: boolean }) {
      return <MiniMonth open={open} anchorMonth={ANCHOR} highlightDates={[]} onSelectDay={() => {}} onBrowseMonth={() => {}} />
    }
    seedStore([], makeRoots('note.md'))
    const { rerender } = render(<Host open />)
    fireEvent.click(screen.getByRole('button', { name: 'September 2026' }))
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-current', 'date')

    // Closing (panel collapses, still mounted) must not itself snap the
    // browsed month back — only a fresh *open* does.
    rerender(<Host open={false} />)
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-current', 'date')

    rerender(<Host open />)
    expect(screen.getByRole('button', { name: 'August 2026' })).toHaveAttribute('aria-current', 'date')
  }, 20000)

  // monthNav='buttons' (the desktop popover's own shape — see _app.tsx) swaps
  // MonthStrip's chip row for the grid's own normally-hidden caption/chevrons
  // instead — the inverse of the 'strip' default above, never both at once.
  it("pages via the grid's own prev/next chevrons under monthNav='buttons', with no month-chip row rendered", () => {
    const { container, onSelectDay, onBrowseMonth } = renderMini([], { monthNav: 'buttons' })
    expect(screen.queryByRole('group', { name: 'Jump to month' })).not.toBeInTheDocument()
    // Three panes are mounted (see PANE_COUNT), each with its own nav — only
    // the center one (index CENTER_PANE) is interactive, so the click must
    // target that one specifically rather than whichever "Go to the Next
    // Month" button a plain getByRole happens to find first.
    const centerCalendar = container.querySelectorAll<HTMLElement>('[data-slot="calendar"]')[1]
    if (!centerCalendar) throw new Error('center pane not rendered')
    fireEvent.click(within(centerCalendar).getByRole('button', { name: 'Go to the Next Month' }))
    expect(onSelectDay).not.toHaveBeenCalled()
    expect(onBrowseMonth).toHaveBeenCalledExactlyOnceWith(new Date(2026, 8, 1))
  }, 20000)
})
