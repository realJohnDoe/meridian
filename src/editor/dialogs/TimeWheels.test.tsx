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

  it('wraps from the first hour to the last with ArrowUp', () => {
    const { onChange, hour } = renderWheels('00:30')

    fireEvent.keyDown(hour, { key: 'ArrowUp' })

    expect(onChange).toHaveBeenCalledWith('23:30')
  })

  it('wraps from the last hour to the first with ArrowDown', () => {
    const { onChange, hour } = renderWheels('23:30')

    fireEvent.keyDown(hour, { key: 'ArrowDown' })

    expect(onChange).toHaveBeenCalledWith('00:30')
  })

  it('carries the hour forward when the minute wraps past 55', () => {
    const { onChange, minute } = renderWheels('09:55')

    fireEvent.keyDown(minute, { key: 'ArrowDown' })

    expect(onChange).toHaveBeenCalledWith('10:00')
  })

  it('carries the hour backward when the minute wraps past 00', () => {
    const { onChange, minute } = renderWheels('09:00')

    fireEvent.keyDown(minute, { key: 'ArrowUp' })

    expect(onChange).toHaveBeenCalledWith('08:55')
  })

  it('wraps the hour along with the minute at the day boundary', () => {
    const { onChange, minute } = renderWheels('23:55')

    fireEvent.keyDown(minute, { key: 'ArrowDown' })

    expect(onChange).toHaveBeenCalledWith('00:00')
  })

  it('ignores keys other than the arrows', () => {
    const { onChange, hour } = renderWheels('09:30')

    fireEvent.keyDown(hour, { key: 'Enter' })

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('TimeWheels — scrolling', () => {
  // A ghost row previewing the opposite end of the list sits before the real
  // items (so the wheel has something to scroll onto when wrapping), which
  // shifts every real row's scroll offset up by one ITEM_H versus its plain
  // index in `items`.
  it('translates scroll offset into the row at that index', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, 6 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('05:30')
  })

  it('rounds a scroll offset that lands between rows to the nearer one', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, 6 * ITEM_H + 0.6 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('06:30')
  })

  it('wraps a scroll past the end back to the first row', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, 99 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('00:30')
  })

  it('wraps a scroll before the start back to the last row', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, -50 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('23:30')
  })

  // The hop off the ghost waits for the fling to be over. Doing it the moment
  // the boundary is touched would give the momentum animation fresh runway to
  // hit the boundary again — one flick, many carries.
  it('re-centers onto the real row once scrolling goes quiet, not immediately', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')

    setScrollTop(hour, 99 * ITEM_H)
    fireEvent.scroll(hour)
    expect(hour.scrollTop).toBe(99 * ITEM_H)  // still parked on the ghost

    vi.advanceTimersByTime(SETTLE_MS)

    // Wrapped to hour 0 (ext index 1): real items start at ext index 1.
    expect(hour.scrollTop).toBe(1 * ITEM_H)
  })

  // Regression: a fling fires many scroll events while it sits on the ghost.
  // Each used to be taken as a fresh boundary crossing, so a single flick
  // could carry the hour through a whole run of values at once.
  it('emits one carry per boundary crossing, however many scroll events fire there', () => {
    const { onChange, minute } = renderWheels('09:55')

    setScrollTop(minute, 13 * ITEM_H)     // ext N+1 — the wrap ghost
    fireEvent.scroll(minute)
    fireEvent.scroll(minute)
    fireEvent.scroll(minute)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('10:00')
  })

  // Regression: writing scrollTop provokes another scroll event, which used to
  // run before React re-rendered and so still saw the pre-carry hour. It
  // re-emitted with carry 0 and overwrote 10:00 back to 09:00 — the carry
  // looked like it never happened.
  it('does not undo the carry when the re-centering scroll echoes back', () => {
    vi.useFakeTimers()
    const { onChange, minute } = renderWheels('09:55')

    setScrollTop(minute, 13 * ITEM_H)
    fireEvent.scroll(minute)
    expect(onChange).toHaveBeenLastCalledWith('10:00')

    vi.advanceTimersByTime(SETTLE_MS)     // hop to the real row…
    fireEvent.scroll(minute)              // …and the echo that write provokes

    expect(onChange).toHaveBeenLastCalledWith('10:00')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not re-emit when the scroll lands on the row already selected', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, 10 * ITEM_H)
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

    setScrollTop(hour, 6 * ITEM_H + 10)
    fireEvent.scroll(hour)
    expect(scrollTo).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SETTLE_MS)

    expect(scrollTo).toHaveBeenCalledWith({ top: 6 * ITEM_H, behavior: 'smooth' })
  })

  it('leaves a column already resting on a row alone', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')
    const scrollTo = vi.fn()
    hour.scrollTo = scrollTo

    setScrollTop(hour, 6 * ITEM_H)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('debounces the settle timer, so only the final resting place is snapped to', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')
    const scrollTo = vi.fn()
    hour.scrollTo = scrollTo

    setScrollTop(hour, 4 * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS - 20)

    setScrollTop(hour, 8 * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 8 * ITEM_H, behavior: 'smooth' })
  })
})
