// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { useQuickNavSwipe } from './useQuickNavSwipe'
import { calendarView } from './viewState'

afterEach(() => {
  cleanup()
  calendarView.setState({ quickNavOpen: false })
})

function Harness({ enabled = true }: { enabled?: boolean }) {
  const ref = useQuickNavSwipe<HTMLDivElement>(enabled)
  return createElement('div', { ref, 'data-testid': 'chrome' })
}

function swipe(el: Element, fromY: number, toY: number) {
  fireEvent.touchStart(el, { touches: [{ clientY: fromY }] })
  fireEvent.touchEnd(el, { changedTouches: [{ clientY: toY }] })
}

describe('useQuickNavSwipe', () => {
  it('opens the panel on a downward swipe past the threshold', () => {
    const { getByTestId } = render(createElement(Harness))
    swipe(getByTestId('chrome'), 0, 80)
    expect(calendarView.getState().quickNavOpen).toBe(true)
  })

  it('closes the panel on an upward swipe past the threshold', () => {
    calendarView.setState({ quickNavOpen: true })
    const { getByTestId } = render(createElement(Harness))
    swipe(getByTestId('chrome'), 80, 0)
    expect(calendarView.getState().quickNavOpen).toBe(false)
  })

  it('ignores a swipe shorter than the threshold', () => {
    const { getByTestId } = render(createElement(Harness))
    swipe(getByTestId('chrome'), 0, 20)
    expect(calendarView.getState().quickNavOpen).toBe(false)
  })

  it('does not close an already-closed panel on an upward swipe', () => {
    const { getByTestId } = render(createElement(Harness))
    swipe(getByTestId('chrome'), 80, 0)
    expect(calendarView.getState().quickNavOpen).toBe(false)
  })

  it('does not open an already-open panel on a downward swipe', () => {
    calendarView.setState({ quickNavOpen: true })
    const { getByTestId } = render(createElement(Harness))
    swipe(getByTestId('chrome'), 0, 80)
    expect(calendarView.getState().quickNavOpen).toBe(true)
  })

  it('does nothing when disabled', () => {
    const { getByTestId } = render(createElement(Harness, { enabled: false }))
    swipe(getByTestId('chrome'), 0, 80)
    expect(calendarView.getState().quickNavOpen).toBe(false)
  })

  it('ignores multi-touch gestures', () => {
    const { getByTestId } = render(createElement(Harness))
    const el = getByTestId('chrome')
    fireEvent.touchStart(el, { touches: [{ clientY: 0 }, { clientY: 0 }] })
    fireEvent.touchEnd(el, { changedTouches: [{ clientY: 80 }] })
    expect(calendarView.getState().quickNavOpen).toBe(false)
  })
})
