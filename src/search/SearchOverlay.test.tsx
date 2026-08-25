// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SearchOverlay from './SearchOverlay'
import { SidebarProvider } from '@/components/ui/sidebar'
import { setMediaQuery } from '@/test-utils'

// The results list is exercised by SearchResults.test.tsx and drags in
// @tanstack/react-virtual, which needs jsdom layout stubs to render anything.
// These tests are about how the overlay is dismissed, so stub it out.
vi.mock('./SearchResults', () => ({
  default: () => <div data-testid="results" />,
}))

// useSidebar's isMobile comes from useMediaQuery, so this drives which of the
// overlay's two shapes renders.
const setMobile = setMediaQuery(true)

function renderOverlay({ mobile, query = 'foo' }: { mobile: boolean; query?: string }) {
  const onClose = vi.fn()
  act(() => { setMobile(mobile) })
  render(
    <SidebarProvider>
      <SearchOverlay
        open
        query={query}
        onQueryChange={vi.fn()}
        onClose={onClose}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
      />
    </SidebarProvider>,
  )
  return { onClose }
}

function pressEscape() {
  act(() => { fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' }) })
}

describe('SearchOverlay dismissal', () => {
  it('closes on Escape from the mobile layer', () => {
    const { onClose } = renderOverlay({ mobile: true })

    pressEscape()

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape from the desktop popover', () => {
    // Desktop keeps focus in SearchBar's input, outside this component's tree —
    // the listener has to be document-level to see it.
    const { onClose } = renderOverlay({ mobile: false })

    pressEscape()

    expect(onClose).toHaveBeenCalled()
  })

  it('closes when the desktop backdrop is clicked', () => {
    const { onClose } = renderOverlay({ mobile: false })

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('marks the mobile layer as a modal dialog', () => {
    renderOverlay({ mobile: true })

    const dialog = screen.getByRole('dialog', { name: 'Search' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('focuses the input when the mobile layer opens, so the keyboard rises', () => {
    renderOverlay({ mobile: true })

    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search or create…'))
  })

  it('traps Tab inside the mobile layer, making its aria-modal claim true', () => {
    renderOverlay({ mobile: true })

    // Trapped range: Close search → input → Clear search (the query is 'foo',
    // so the clear button is showing).
    const clear = screen.getByRole('button', { name: 'Clear search' })
    clear.focus()
    act(() => { fireEvent.keyDown(clear, { key: 'Tab' }) })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close search' }))
  })

  it('leaves focus outside its own tree alone on desktop', () => {
    // Desktop's input lives in SearchBar, above this component — trapping Tab
    // here would yank focus out of the field being typed into.
    const outside = document.createElement('button')
    document.body.append(outside)
    renderOverlay({ mobile: false })
    outside.focus()

    act(() => { fireEvent.keyDown(outside, { key: 'Tab' }) })

    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('stays inert on desktop until there is a query', () => {
    // Desktop renders nothing for an empty query, so Escape must not fire a
    // close for an overlay that isn't on screen.
    const { onClose } = renderOverlay({ mobile: false, query: '' })
    expect(screen.queryByTestId('results')).toBeNull()

    pressEscape()

    expect(onClose).not.toHaveBeenCalled()
  })
})
