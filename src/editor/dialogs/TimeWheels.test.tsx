// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import TimeWheels from './TimeWheels'

// These must match TimeWheels' own constants.
const ITEM_H = 40
const SETTLE_MS = 120
const RUNWAY_PX = 2000

// The list is repeated enough times to give a fling RUNWAY_PX of travel in
// both directions, so a row's scroll offset is its index within that strip,
// not within `items`. `home` is the start of the middle copy, where a column
// sits at rest.
function geometry(len: number) {
  const periods = Math.ceil(RUNWAY_PX / (len * ITEM_H)) * 2 + 1
  return { total: periods * len, home: Math.floor(periods / 2) * len }
}
const H = geometry(24)   // hours:   home 72
const M = geometry(12)   // minutes: home 60

function renderWheels(value: string) {
  const onChange = vi.fn()
  render(<TimeWheels value={value} onChange={onChange} />)
  return {
    onChange,
    hour:   screen.getByRole('listbox', { name: 'Hour' }),
    minute: screen.getByRole('listbox', { name: 'Minute' }),
  }
}

// A controlled host, for the cases where the emitted value has to feed back in
// — a carry only moves the hour column because the new value returns as a prop.
function renderLive(initial: string) {
  const emitted = vi.fn()
  function Host() {
    const [v, setV] = useState(initial)
    return <TimeWheels value={v} onChange={next => { emitted(next); setV(next) }} />
  }
  render(<Host />)
  return {
    emitted,
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
  // Offsets are strip rows, so a column at rest on hour 9 sits at H.home + 9,
  // not at 9. One pad row above the strip is what makes row k centre at
  // exactly k * ITEM_H.
  it('translates scroll offset into the row at that index', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home + 5) * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('05:30')
  })

  it('rounds a scroll offset that lands between rows to the nearer one', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home + 5) * ITEM_H + 0.6 * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('06:30')
  })

  it('rolls past the end of the list onto the first row', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home + 24) * ITEM_H)   // one whole period on
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('00:30')
  })

  it('rolls before the start of the list onto the last row', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home - 1) * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).toHaveBeenCalledWith('23:30')
  })

  it('does not re-emit when the scroll lands on the row already selected', () => {
    const { onChange, hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home + 9) * ITEM_H)
    fireEvent.scroll(hour)

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('TimeWheels — carrying the hour', () => {
  it('carries the hour forward when the minutes roll past the end', () => {
    const { onChange, minute } = renderWheels('09:55')

    setScrollTop(minute, (M.home + 12) * ITEM_H)
    fireEvent.scroll(minute)

    expect(onChange).toHaveBeenCalledWith('10:00')
  })

  it('carries the hour backward when the minutes roll before the start', () => {
    const { onChange, minute } = renderWheels('09:00')

    setScrollTop(minute, (M.home - 1) * ITEM_H)
    fireEvent.scroll(minute)

    expect(onChange).toHaveBeenCalledWith('08:55')
  })

  // The strip is long enough that momentum keeps running through the wrap
  // instead of dead-ending on it, so a hard fling can cover several laps —
  // and each lap is a real hour, exactly as on a geared wheel.
  it('carries one hour per lap when a fling spins through several', () => {
    const { onChange, minute } = renderWheels('09:55')

    setScrollTop(minute, (M.home + 24) * ITEM_H)   // two whole periods on
    fireEvent.scroll(minute)

    expect(onChange).toHaveBeenCalledWith('11:00')
  })

  // Regression: a fling fires many scroll events, and each used to be taken
  // as a fresh boundary crossing — one flick, a whole run of hours.
  it('emits once while the position is unchanged, however many events fire', () => {
    const { onChange, minute } = renderWheels('09:55')

    setScrollTop(minute, (M.home + 12) * ITEM_H)
    fireEvent.scroll(minute)
    fireEvent.scroll(minute)
    fireEvent.scroll(minute)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('10:00')
  })

  // Regression: the re-centering write provokes another scroll event, which
  // used to run before React re-rendered, still see the pre-carry hour, and
  // overwrite 10:00 back to 09:00 — the carry looked like it never happened.
  // Controlled, because the settling pass now checks the row it rests on
  // against the value it was given back — with a host that drops the value
  // it would rightly re-emit, and the echo would be lost in the noise.
  it('does not undo the carry when the re-centering scroll echoes back', () => {
    vi.useFakeTimers()
    const { emitted, minute } = renderLive('09:55')

    setScrollTop(minute, (M.home + 12) * ITEM_H)
    fireEvent.scroll(minute)
    expect(emitted).toHaveBeenLastCalledWith('10:00')

    act(() => { vi.advanceTimersByTime(SETTLE_MS) })   // hop to the middle period…
    fireEvent.scroll(minute)                           // …and the echo it provokes

    expect(emitted).toHaveBeenLastCalledWith('10:00')
    expect(emitted).toHaveBeenCalledTimes(1)
  })

  it('rolls the hour column over with the minutes, one row, animated', () => {
    const { emitted, hour, minute } = renderLive('09:55')
    const scrollTo = vi.fn()
    hour.scrollTo = scrollTo
    setScrollTop(hour, (H.home + 9) * ITEM_H)

    setScrollTop(minute, (M.home + 12) * ITEM_H)
    fireEvent.scroll(minute)

    expect(emitted).toHaveBeenCalledWith('10:00')
    expect(selected(hour)).toBe('10')
    // One row on from where it stood, eased rather than jumped.
    expect(scrollTo).toHaveBeenCalledWith({ top: (H.home + 10) * ITEM_H, behavior: 'smooth' })
  })

  it('takes the short way round when the hour wraps across midnight', () => {
    const { emitted, hour, minute } = renderLive('23:55')
    const scrollTo = vi.fn()
    hour.scrollTo = scrollTo
    setScrollTop(hour, (H.home + 23) * ITEM_H)

    setScrollTop(minute, (M.home + 12) * ITEM_H)
    fireEvent.scroll(minute)

    expect(emitted).toHaveBeenCalledWith('00:00')
    // Forward one row onto the next copy of 00 — not back 23 rows to this
    // period's own 00, which would visibly unwind the whole wheel.
    expect(scrollTo).toHaveBeenCalledWith({ top: (H.home + 24) * ITEM_H, behavior: 'smooth' })
  })
})

describe('TimeWheels — settling', () => {
  it('returns to the middle period once scrolling goes quiet', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home + 24 + 5) * ITEM_H)   // a period out from home
    fireEvent.scroll(hour)
    expect(hour.scrollTop).toBe((H.home + 24 + 5) * ITEM_H)   // left alone mid-fling

    vi.advanceTimersByTime(SETTLE_MS)

    // Same row to look at, but with a full runway again in both directions.
    expect(hour.scrollTop).toBe((H.home + 5) * ITEM_H)
  })

  // The safety net for a snap interrupted mid-fling: after SETTLE_MS of quiet,
  // a column resting between rows is squared up onto the nearest one.
  it('squares up a column left between rows', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home + 6) * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(hour.scrollTop).toBe((H.home + 6) * ITEM_H)
  })

  it('leaves a column already resting on its home row alone', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home + 6) * ITEM_H)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(hour.scrollTop).toBe((H.home + 6) * ITEM_H)
  })

  it('debounces the settle timer, so only the final resting place is kept', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')

    setScrollTop(hour, (H.home + 4) * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS - 20)

    setScrollTop(hour, (H.home + 8) * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(hour.scrollTop).toBe((H.home + 8) * ITEM_H)
  })
})

describe('TimeWheels — recovering from an interrupted animation', () => {
  // The bug this guards: while a roll was in flight every scroll event was
  // swallowed, and the settle pass was scheduled only if the animation landed
  // exactly on target. An animation cut short therefore left the column
  // resting between rows, still bolding the value it had set out for, with
  // nothing pending to reconcile the two.
  const ANIM_MS = 500

  it('squares up and adopts the row it rests on when a roll never lands', () => {
    vi.useFakeTimers()
    const { emitted, hour } = renderLive('09:30')
    setScrollTop(hour, (H.home + 9) * ITEM_H)
    hour.scrollTo = vi.fn()   // an animation that is never carried out

    // Send it rolling to 14, then drag elsewhere while that roll is pending.
    fireEvent.click(within(hour).getByRole('option', { name: '14' }))
    setScrollTop(hour, (H.home + 6) * ITEM_H)
    fireEvent.scroll(hour)

    act(() => { vi.advanceTimersByTime(ANIM_MS + SETTLE_MS) })

    expect(hour.scrollTop).toBe((H.home + 6) * ITEM_H)
    expect(emitted).toHaveBeenLastCalledWith('06:30')
    expect(selected(hour)).toBe('06')
  })

  it('leaves a column resting off-grid squared up on a row', () => {
    vi.useFakeTimers()
    const { hour } = renderLive('09:30')
    setScrollTop(hour, (H.home + 9) * ITEM_H)
    hour.scrollTo = vi.fn()

    fireEvent.click(within(hour).getByRole('option', { name: '14' }))
    setScrollTop(hour, (H.home + 6) * ITEM_H + 17)   // stranded between rows
    fireEvent.scroll(hour)

    act(() => { vi.advanceTimersByTime(ANIM_MS + SETTLE_MS) })

    expect(hour.scrollTop % ITEM_H).toBe(0)
  })

  it('keeps the value and the resting row in step after a settle', () => {
    vi.useFakeTimers()
    const { hour } = renderLive('09:30')
    setScrollTop(hour, (H.home + 9) * ITEM_H)
    hour.scrollTo = vi.fn()

    fireEvent.click(within(hour).getByRole('option', { name: '14' }))
    setScrollTop(hour, (H.home + 2) * ITEM_H)
    fireEvent.scroll(hour)
    act(() => { vi.advanceTimersByTime(ANIM_MS + SETTLE_MS) })

    // The row under the highlight and the bolded value are the same row.
    const restingRow = hour.scrollTop / ITEM_H
    expect(selected(hour)).toBe(String((restingRow - H.home) % 24).padStart(2, '0'))
  })
})

describe('TimeWheels — handing the wheel back to the user mid-roll', () => {
  // A roll swallows scroll events so its own animation is not mistaken for
  // the user turning the wheel. Any sign of a real hand on it has to lift
  // that guard at once, or the column keeps moving under a user who has
  // already grabbed it and drifts away from the value it shows. A trackpad
  // fires only `wheel`, which is how this last slipped through.
  const grabs = [
    ['a wheel notch',  (el: HTMLElement) => fireEvent.wheel(el)],
    ['a finger down',  (el: HTMLElement) => fireEvent.touchStart(el)],
    ['a pointer down', (el: HTMLElement) => fireEvent.pointerDown(el)],
  ] as const

  it.each(grabs)('lets %s take over from a roll in flight', (_label, grab) => {
    const { emitted, hour } = renderLive('09:30')
    setScrollTop(hour, (H.home + 9) * ITEM_H)
    hour.scrollTo = vi.fn()          // a roll that is still on its way

    fireEvent.click(within(hour).getByRole('option', { name: '14' }))
    emitted.mockClear()

    grab(hour)
    setScrollTop(hour, (H.home + 6) * ITEM_H)
    fireEvent.scroll(hour)

    // Acted on straight away rather than swallowed as part of the roll.
    expect(emitted).toHaveBeenCalledWith('06:30')
  })

  it('swallows the roll’s own scrolls while no one has grabbed it', () => {
    const { emitted, hour } = renderLive('09:30')
    setScrollTop(hour, (H.home + 9) * ITEM_H)
    hour.scrollTo = vi.fn()

    fireEvent.click(within(hour).getByRole('option', { name: '14' }))
    emitted.mockClear()

    setScrollTop(hour, (H.home + 11) * ITEM_H)   // the roll passing through
    fireEvent.scroll(hour)

    expect(emitted).not.toHaveBeenCalled()
  })

  it('takes the wheel back once the roll lands on its row', () => {
    const { emitted, hour } = renderLive('09:30')
    setScrollTop(hour, (H.home + 9) * ITEM_H)
    // A roll that lands: jsdom runs no scroll animation, so apply it at once.
    // `scrollTo` is overloaded (options, or x and y), hence the union.
    hour.scrollTo = (o?: number | ScrollToOptions) => {
      hour.scrollTop = typeof o === 'object' ? o.top ?? 0 : 0
    }

    fireEvent.click(within(hour).getByRole('option', { name: '14' }))
    fireEvent.scroll(hour)                        // arrives on target, guard lifts
    emitted.mockClear()

    setScrollTop(hour, (H.home + 3) * ITEM_H)
    fireEvent.scroll(hour)

    expect(emitted).toHaveBeenCalledWith('03:30')
  })
})

describe('TimeWheels — holding through settle', () => {
  // Regression: a touch held still (no movement, so no further scroll events)
  // used to get snapped out from under the finger the moment the quiet-scroll
  // timer fired, because settle had no way to know the hold hadn't ended.
  it('does not snap while a touch is still down, even once the settle timer would fire', () => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')

    fireEvent.touchStart(hour)
    setScrollTop(hour, (H.home + 6) * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS * 2)

    expect(hour.scrollTop).toBe((H.home + 6) * ITEM_H + 10)   // left alone mid-hold
  })

  const releases = [
    ['touchend',      (el: HTMLElement) => fireEvent.touchEnd(el)],
    ['touchcancel',   (el: HTMLElement) => fireEvent.touchCancel(el)],
    ['pointerup',     (el: HTMLElement) => fireEvent.pointerUp(el)],
    ['pointercancel', (el: HTMLElement) => fireEvent.pointerCancel(el)],
  ] as const

  it.each(releases)('snaps once the hold ends via %s', (_label, release) => {
    vi.useFakeTimers()
    const { hour } = renderWheels('09:30')

    fireEvent.touchStart(hour)
    setScrollTop(hour, (H.home + 6) * ITEM_H + 10)
    fireEvent.scroll(hour)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(hour.scrollTop).toBe((H.home + 6) * ITEM_H + 10)   // still held, still off-grid

    release(hour)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(hour.scrollTop).toBe((H.home + 6) * ITEM_H)   // squared up now that it's released
  })
})
