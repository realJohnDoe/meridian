// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { FloatingComboboxPlacement } from '@/hooks'
import { FloatingComboboxList } from './FloatingComboboxList'

const BOTTOM: FloatingComboboxPlacement = { side: 'bottom', left: 24, maxWidth: 300, maxHeight: 200, top: 120 }
const TOP:    FloatingComboboxPlacement = { side: 'top',    left: 24, maxWidth: 300, maxHeight: 200, bottom: 80 }

function renderList(placement: FloatingComboboxPlacement | null) {
  const listRef = createRef<HTMLDivElement>()
  const { container } = render(
    <FloatingComboboxList placement={placement} listRef={listRef}>
      <button type="button">Weekly review</button>
    </FloatingComboboxList>,
  )
  return { container, listRef }
}

describe('FloatingComboboxList', () => {
  it('renders nothing until a placement has been measured', () => {
    const { container } = renderList(null)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('portals to document.body rather than rendering in place', () => {
    const { container } = renderList(BOTTOM)
    const list = screen.getByRole('listbox')
    expect(container).toBeEmptyDOMElement()
    expect(list.parentElement).toBe(document.body)
  })

  it('attaches the caller ref to the portaled list', () => {
    const { listRef } = renderList(BOTTOM)
    expect(listRef.current).toBe(screen.getByRole('listbox'))
  })

  it('anchors from the top when opening downward', () => {
    renderList(BOTTOM)
    const list = screen.getByRole('listbox')
    expect(list).toHaveAttribute('data-side', 'bottom')
    expect(list.style.top).toBe('120px')
    expect(list.style.bottom).toBe('')
  })

  it('anchors from the bottom when opening upward', () => {
    renderList(TOP)
    const list = screen.getByRole('listbox')
    expect(list).toHaveAttribute('data-side', 'top')
    expect(list.style.bottom).toBe('80px')
    expect(list.style.top).toBe('')
  })

  it('applies the measured horizontal offset and size caps', () => {
    renderList(BOTTOM)
    const list = screen.getByRole('listbox')
    expect(list.style.left).toBe('24px')
    expect(list.style.maxWidth).toBe('300px')
    expect(list.style.maxHeight).toBe('200px')
  })

  // Radix's modal Dialog/Drawer sets `body { pointer-events: none }` while open
  // and re-enables it only on its own registered layers. This list portals
  // straight to body, outside that system, so without the explicit override it
  // renders fine but swallows every click when opened inside a modal.
  it('re-enables pointer events, so selections work inside an open modal', () => {
    renderList(BOTTOM)
    expect(screen.getByRole('listbox').className).toContain('pointer-events-auto')
  })

  // Suppressing the default keeps focus on the (never-moving) input, so the
  // combobox does not tear down between mousedown and click.
  it('prevents the default mousedown so focus stays on the input', () => {
    renderList(BOTTOM)
    const notPrevented = fireEvent.mouseDown(screen.getByRole('listbox'))
    expect(notPrevented).toBe(false)
  })

  it('renders its children as the list contents', () => {
    renderList(BOTTOM)
    expect(screen.getByRole('button', { name: 'Weekly review' })).toBeInTheDocument()
  })
})
