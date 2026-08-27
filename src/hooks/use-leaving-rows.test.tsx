// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useLeavingRows } from './use-leaving-rows'

/**
 * Renders the merged list as `key:leaving?` text, and exposes the hook's two
 * controls as buttons, so a test can drive a leave the way a list would.
 */
function Harness({ initial }: { initial: string[] }) {
  const [items, setItems] = useState(initial)
  const { rows, beginLeave, endLeave, anyLeaving } = useLeavingRows(items, k => k)
  return (
    <div>
      <div data-testid="rows">{rows.map(r => `${r.key}${r.leaving ? '*' : ''}`).join(',')}</div>
      <div data-testid="any">{String(anyLeaving)}</div>
      {initial.map(k => (
        <button
          key={k}
          type="button"
          onClick={() => { beginLeave(k); setItems(prev => prev.filter(i => i !== k)) }}
        >remove {k}</button>
      ))}
      {initial.map(k => (
        <button key={`e${k}`} type="button" onClick={() => { endLeave(k) }}>end {k}</button>
      ))}
      {/* Begins a leave without the data dropping the row — the case where a
          list marks a row as leaving and then keeps it after all. */}
      {initial.map(k => (
        <button key={`o${k}`} type="button" onClick={() => { beginLeave(k) }}>leave-only {k}</button>
      ))}
    </div>
  )
}

const rows = () => screen.getByTestId('rows').textContent

describe('useLeavingRows', () => {
  it('passes the list straight through when nothing is leaving', () => {
    render(<Harness initial={['a', 'b', 'c']} />)
    expect(rows()).toBe('a,b,c')
    expect(screen.getByTestId('any')).toHaveTextContent('false')
  })

  // The row has to go back where it was: spliced at the index it held, so the
  // rows around it stay put and only it collapses.
  it('holds a removed row in the place it already occupied', () => {
    render(<Harness initial={['a', 'b', 'c']} />)
    act(() => { screen.getByText('remove b').click() })

    expect(rows()).toBe('a,b*,c')
    expect(screen.getByTestId('any')).toHaveTextContent('true')
  })

  it('releases the row once it reports the collapse finished', () => {
    render(<Harness initial={['a', 'b', 'c']} />)
    act(() => { screen.getByText('remove b').click() })
    act(() => { screen.getByText('end b').click() })

    expect(rows()).toBe('a,c')
    expect(screen.getByTestId('any')).toHaveTextContent('false')
  })

  it('holds several rows at once, each in its own place', () => {
    render(<Harness initial={['a', 'b', 'c', 'd']} />)
    act(() => { screen.getByText('remove b').click() })
    act(() => { screen.getByText('remove d').click() })

    expect(rows()).toBe('a,b*,c,d*')
  })

  // Rendering the retained copy *and* the live one would put the same key on
  // screen twice, which React reads as a duplicate rather than a row mid-exit.
  it('never renders a key twice when the data keeps a row that began leaving', () => {
    render(<Harness initial={['a', 'b']} />)
    act(() => { screen.getByText('leave-only a').click() })

    expect(rows()).toBe('a*,b')
  })

  it('ignores a leave for a row that is not in the list', () => {
    render(<Harness initial={['a']} />)
    act(() => { screen.getByText('end a').click() })
    expect(rows()).toBe('a')
    expect(screen.getByTestId('any')).toHaveTextContent('false')
  })

  it('keeps a held row at the end when the rows after it went too', () => {
    render(<Harness initial={['a', 'b', 'c']} />)
    act(() => { screen.getByText('remove c').click() })
    expect(rows()).toBe('a,b,c*')
  })
})
