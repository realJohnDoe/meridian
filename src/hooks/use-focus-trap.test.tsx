// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useFocusTrap } from './use-focus-trap'

/**
 * jsdom never lays anything out, so a trap that filtered tabbables on geometry
 * would find none here and pass vacuously. These assertions are all about which
 * element ends up focused, which jsdom does model faithfully.
 */
function Harness({ restoreFocus = true, autoFocusSecond = false }: { restoreFocus?: boolean; autoFocusSecond?: boolean }) {
  const [active, setActive] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const secondRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(ref, active, { restoreFocus, initialFocus: autoFocusSecond ? secondRef : undefined })
  return (
    <>
      <button type="button" onClick={() => setActive(true)}>open</button>
      <button type="button">outside</button>
      {active && (
        <div ref={ref} role="dialog" aria-label="trapped" tabIndex={-1}>
          <button type="button">first</button>
          <button type="button" ref={secondRef}>second</button>
          <button type="button" disabled>disabled</button>
          <button type="button">last</button>
        </div>
      )}
      <button type="button" onClick={() => setActive(false)}>close</button>
    </>
  )
}

const btn = (name: string) => screen.getByRole('button', { name })
const tab = (shiftKey = false) =>
  act(() => { fireEvent.keyDown(document.activeElement ?? document, { key: 'Tab', shiftKey }) })

describe('useFocusTrap', () => {
  it('focuses the container on activate and returns focus to the opener on deactivate', () => {
    render(<Harness />)
    btn('open').focus()

    fireEvent.click(btn('open'))
    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    fireEvent.click(btn('close'))
    expect(document.activeElement).toBe(btn('open'))
  })

  it('honours initialFocus over the container', () => {
    render(<Harness autoFocusSecond />)
    fireEvent.click(btn('open'))

    expect(document.activeElement).toBe(btn('second'))
  })

  it('leaves focus alone on deactivate when restoreFocus is off', () => {
    render(<Harness restoreFocus={false} />)
    btn('open').focus()
    fireEvent.click(btn('open'))

    fireEvent.click(btn('close'))

    expect(document.activeElement).not.toBe(btn('open'))
  })

  it('wraps Tab from the last tabbable back to the first, skipping disabled ones', () => {
    render(<Harness />)
    fireEvent.click(btn('open'))
    btn('last').focus()

    tab()

    expect(document.activeElement).toBe(btn('first'))
  })

  it('wraps Shift+Tab from the first tabbable to the last', () => {
    render(<Harness />)
    fireEvent.click(btn('open'))
    btn('first').focus()

    tab(true)

    expect(document.activeElement).toBe(btn('last'))
  })

  it('wraps Shift+Tab off the container itself to the last tabbable', () => {
    render(<Harness />)
    fireEvent.click(btn('open'))
    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    tab(true)

    expect(document.activeElement).toBe(btn('last'))
  })

  it('does not intercept Tab in the middle of the trapped range', () => {
    render(<Harness />)
    fireEvent.click(btn('open'))
    btn('first').focus()

    // Native tab order takes it to `second`; jsdom does not move focus itself,
    // so what matters is that the trap left the event alone.
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => { document.activeElement!.dispatchEvent(e) })

    expect(e.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(btn('first'))
  })

  it('pulls focus back in when it escaped to the app behind', () => {
    render(<Harness />)
    fireEvent.click(btn('open'))
    btn('outside').focus()

    tab()

    expect(document.activeElement).toBe(btn('first'))
  })

  it('does nothing while inactive', () => {
    render(<Harness />)
    btn('outside').focus()

    tab()

    expect(document.activeElement).toBe(btn('outside'))
  })
})
