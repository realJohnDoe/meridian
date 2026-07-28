// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import TimeWheels from './TimeWheels'

const ITEM_H = 40    // must match TimeWheels' own constant
const SETTLE_MS = 120

function renderWheels(value: string) {
  const onChange = vi.fn()
  render(<TimeWheels value={value} onChange={onChange} />)
  return {
    onChange,
    hour:   screen.getByRole('listbox', { name: 'Hour' }),
    minute: screen.getByRole('listbox', { name: 'Minute' }),
  }
}

const selected = (col: HTMLElement) =>
  within(col).getAllByRole('option').find(o => o.getAttribute('aria-selected') === 'true')?.textContent

// jsdom has no layout, so the scrollTop accessor on the prototype always reads
// 0 and ignores writes. Shadowing it with an own property is what makes the
// component's scrollTop -> index arithmetic reachable at all.
function setScrollTop(el: HTMLElement, px: number) {
  Object.defineProperty(el, 'scrollTop', { value: px, writable: true, configurable: true })
}

afterEach(() => { vi.useRealTimers() })

describe('TimeWheels — value parsing', () => {
  it('selects the hour and minute given by an HH:MM value', () => {
    const { hour, minute } = renderWheels('09:30')
    expect(selected(hour)).toBe('09')
    expect(selected(minute)).toBe('30')
  })

  it('accepts a single-digit hour', () => {
    const { hour } = renderWheels('9:30')
    expect(selected(hour)).toBe('09')
  })

  it('snaps a minute that is off the 5-minute grid to the nearest step', () => {
    expect(selected(renderWheels('09:32').minute)).toBe('30')
  })

  it('rounds up past the halfway point', () => {
    expect(selected(renderWheels('09:33').minute)).toBe('35')
  })

  // Math.round(58 / 5) * 5 === 60, which is not a row — the % 60 wraps it to 00.
  // Without that wrap the minute column would have no selected row at all.
  it('wraps a minute that rounds up to 60 back to 00', () => {
    expect(selected(renderWheels('09:58').minute)).toBe('00')
  })

  it('falls back to 09:00 when the value is unparseable', () => {
    const { hour, minute } = renderWheels('not a time')
    expect(selected(hour)).toBe('09')
    expect(selected(minute)).toBe('00')
  })

  it('offers 24 hours and 12 five-minute rows', () => {
    const { hour, minute } = renderWheels('09:30')
    expect(within(hour).getAllByRole('option')).toHaveLength(24)
    expect(within(minute).getAllByRole('option')).toHaveLength(12)
  })
})

describe('TimeWheels — selection', () => {
  it('emits HH:MM with the other column preserved when an hour is clicked', () => {
    const { onChange, hour } = renderWheels('09:30')

    fireEvent.click(within(hour).getByRole('option', { name: '14' }))

    expect(onChange).toHaveBeenCalledWith('14:30')
  })

  it('emits HH:MM with the other column preserved when a minute is clicked', () => {
    const { onChange, minute } = renderWheels('09:30')

    fireEvent.click(within(minute).getByRole('option', { name: '45' }))

    expect(onChange).toHaveBeenCalledWith('09:45')
  })

  it('steps down with ArrowDown', () => {
    const { onChange, hour } = renderWheels('09:30')

    fireEvent.keyDown(hour, { key: 'ArrowDown' })

    expect(onChange).toHaveBeenCalledWith('10:30')
  })

  it('steps up with ArrowUp', () => {
    const { onChange, minute } = renderWheels('09:30')

    fireEvent.keyDown(minute, { key: 'ArrowUp' })

    expect(onChange).toHaveBeenCalledWith('09:25')
  })

  it('clamps at the first row instead of wrapping', () => {
    const { onChange, hour } = renderWheels('00:30')

    fireEvent.keyDown(hour, { key: 'ArrowUp' })

    expect(onChange).toHaveBeenCalledWith('00:30')
  })

  it('clamps at the last row instead of wrapping', () => {
    const { onChange, hour } = renderWheels('23:30')

    fireEvent.keyDown(hour, { key: 'ArrowDown' })

    expect(onChange).toHaveBeenCalledWith('23:30')
  })

  it('ignores keys other than the arrows', () => {
    const { onChange, hour } = renderWheels('09:30')

    fireEvent.keyDown(hour, { key: 'Enter' })

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('TimeWheels — scrolling', () => {
  it('translates scroll offset into the row at that index', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, 5 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('05:30')
  })

  it('rounds a scroll offset that lands between rows to the nearer one', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, 5 * ITEM_H + 0.6 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('06:30')
  })

  it('clamps a scroll past the end to the last row', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, 99 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('23:30')
  })

  it('does not re-emit when the scroll lands on the row already selected', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, 9 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).not.toHaveBeenCalled()
  })

  // The safety net for a snap interrupted mid-fling: after SETTLE_MS of quiet,
  // a column resting between rows is nudged onto the nearest one.
  it('re-snaps a column left between rows once scrolling goes quiet', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')
    const scrollTo = vi.fn()
    hour.scrollTo = scrollTo

    setScrollTop(hour, 5 * ITEM_H + 10)
    fireEvent.scroll(hour)
    expect(scrollTo).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SETTLE_MS)

    expect(scrollTo).toHaveBeenCalledWith({ top: 5 * ITEM_H, behavior: 'smooth' })
  })

  it('leaves a column already resting on a row alone', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')
    const scrollTo = vi.fn()
    hour.scrollTo = scrollTo

    setScrollTop(hour, 5 * ITEM_H)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('debounces the settle timer, so only the final resting place is snapped to', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')
    const scrollTo = vi.fn()
    hour.scrollTo = scrollTo

    setScrollTop(hour, 3 * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS - 20)

    setScrollTop(hour, 7 * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 7 * ITEM_H, behavior: 'smooth' })
  })
})
