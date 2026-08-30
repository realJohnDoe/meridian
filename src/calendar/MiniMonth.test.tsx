// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MiniMonth from './MiniMonth'
import { setupStore, seedStore, makeRoots, testKey } from '@/test-utils'
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
  const el = container.querySelector<HTMLButtonElement>(`button[data-day="${date.toLocaleDateString()}"]`)
  if (!el) throw new Error(`no day button rendered for ${date.toDateString()}`)
  return el
}

function renderMini(items: StoreOcc[], overrides: Partial<React.ComponentProps<typeof MiniMonth>> = {}) {
  seedStore(items, makeRoots('note.md'))
  const onSelectDay = vi.fn()
  const utils = render(
    <MiniMonth open anchorMonth={ANCHOR} highlightDates={[]} onSelectDay={onSelectDay} {...overrides} />,
  )
  return { ...utils, onSelectDay }
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

  it('highlights the day(s) in highlightDates', () => {
    const { container } = renderMini([], { highlightDates: [new Date(2026, 7, 15)] })
    expect(dayButton(container, new Date(2026, 7, 15))).toHaveClass('bg-primary')
    expect(dayButton(container, new Date(2026, 7, 16))).not.toHaveClass('bg-primary')
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
  it("pages the grid's own month via the month-chip row without calling onSelectDay", () => {
    const { onSelectDay } = renderMini([])
    expect(screen.getByRole('button', { name: 'August 2026' })).toHaveAttribute('aria-current', 'date')
    fireEvent.click(screen.getByRole('button', { name: 'September 2026' }))
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-current', 'date')
    expect(onSelectDay).not.toHaveBeenCalled()
  }, 20000)

  it('re-syncs the browsed month to anchorMonth when the panel re-opens, not while it stays open', () => {
    function Host({ open }: { open: boolean }) {
      return <MiniMonth open={open} anchorMonth={ANCHOR} highlightDates={[]} onSelectDay={() => {}} />
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
})
