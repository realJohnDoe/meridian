// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { SidebarProvider } from '@/components/ui/sidebar'
import { setMediaQuery, setupStore, makeOcc } from '@/test-utils'
import { setCurrentDate } from '@/calendar'
import { entryRoute, newEntryRoute } from '@/entryRoute'
import SearchBar from './-searchBar'

const { navigateMock, searchMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  searchMock: vi.fn<() => { sq?: string }>(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return { ...actual, useNavigate: () => navigateMock, useSearch: () => searchMock() }
})

// The results list and its data flow are covered by SearchOverlay.test.tsx and
// SearchResults.test.tsx; -searchBar.tsx's own job is the docked field and
// wiring props through to the (lazily-loaded) overlay, so the overlay is
// stood in for a marker exposing its props via test-only controls.
vi.mock('@/search', () => ({
  SearchOverlay: ({ query, onClose, onCreate, onOpen }: {
    query: string
    onClose: () => void
    onCreate: (title: string) => void
    onOpen: (occ: ReturnType<typeof makeOcc>) => void
  }) => (
    <div data-testid="search-overlay">
      <span data-testid="overlay-query">{query}</span>
      <button type="button" onClick={onClose}>overlay-close</button>
      <button type="button" onClick={() => onCreate('typed title')}>overlay-create</button>
      <button type="button" onClick={() => onOpen(makeOcc())}>overlay-open</button>
    </div>
  ),
}))

setupStore()
const setMobile = setMediaQuery(false)

function renderSearchBar() {
  return render(
    <SidebarProvider>
      <SearchBar />
    </SidebarProvider>,
  )
}

/** Recovers the object a `useNavigate` call's functional `search` option would produce. */
function searchResultOf(call: unknown, prev: Record<string, unknown> = {}) {
  const { search } = call as { search: (p: Record<string, unknown>) => unknown }
  return search(prev)
}

beforeEach(() => {
  navigateMock.mockClear()
  searchMock.mockReturnValue({})
  setCurrentDate('2026-06-15')
})

describe('SearchBar — closed state', () => {
  it('renders no overlay when sq is absent, with the New entry button always available', () => {
    renderSearchBar()

    expect(screen.queryByTestId('search-overlay')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New entry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('opens the overlay via a replace-free navigation when the field is clicked', () => {
    renderSearchBar()
    fireEvent.click(screen.getByPlaceholderText('Search or create…'))

    expect(navigateMock).toHaveBeenCalledTimes(1)
    const call = navigateMock.mock.calls[0]![0] as { to: string }
    expect(call.to).toBe('.')
    expect(searchResultOf(call)).toEqual({ sq: '' })
  })

  it('creates a new, untitled entry (dated today) from the New entry button when nothing is typed', () => {
    renderSearchBar()
    fireEvent.click(screen.getByRole('button', { name: 'New entry' }))

    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute(undefined, { date: '2026-06-15' }), replace: false })
  })
})

describe('SearchBar — open state', () => {
  it('shows the overlay once sq is present, even as an empty string', async () => {
    searchMock.mockReturnValue({ sq: '' })
    renderSearchBar()

    expect(await screen.findByTestId('search-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('overlay-query')).toHaveTextContent('')
  })

  it('buffers typed input locally and replaces the URL query as it changes', () => {
    searchMock.mockReturnValue({ sq: '' })
    renderSearchBar()

    const input = screen.getByPlaceholderText('Search or create…')
    fireEvent.change(input, { target: { value: 'groceries' } })

    expect(input).toHaveValue('groceries')
    const call = navigateMock.mock.calls.at(-1)![0] as { to: string; replace: boolean }
    expect(call.to).toBe('.')
    expect(call.replace).toBe(true)
    expect(searchResultOf(call)).toEqual({ sq: 'groceries' })
  })

  it('shows a clear button once there is a query, which closes search entirely', () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    const call = navigateMock.mock.calls.at(-1)![0] as { to: string; replace: boolean }
    expect(call.replace).toBe(true)
    expect(searchResultOf(call, { sq: 'groceries' })).toEqual({ sq: undefined })
  })

  it('creates a new entry from Enter when the query is non-empty', () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()

    fireEvent.keyDown(screen.getByPlaceholderText('Search or create…'), { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute('groceries', { date: '2026-06-15' }), replace: true })
  })

  it('does not create an entry from Enter when the query is empty', () => {
    searchMock.mockReturnValue({ sq: '' })
    renderSearchBar()

    fireEvent.keyDown(screen.getByPlaceholderText('Search or create…'), { key: 'Enter' })
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('carries the typed query as the title when creating via the New entry button', () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()
    fireEvent.click(screen.getByRole('button', { name: 'New entry' }))

    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute('groceries', { date: '2026-06-15' }), replace: true })
  })

  it('forwards the overlay\'s create and close callbacks', async () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()
    await screen.findByTestId('search-overlay')

    fireEvent.click(screen.getByRole('button', { name: 'overlay-create' }))
    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute('typed title', { date: '2026-06-15' }), replace: true })

    fireEvent.click(screen.getByRole('button', { name: 'overlay-close' }))
    const call = navigateMock.mock.calls.at(-1)![0] as { to: string; replace: boolean }
    expect(searchResultOf(call, { sq: 'groceries' })).toEqual({ sq: undefined })
  })

  it('opens the chosen occurrence with a replace navigation, so search does not reappear on back', async () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()
    await screen.findByTestId('search-overlay')
    fireEvent.click(screen.getByRole('button', { name: 'overlay-open' }))

    expect(navigateMock).toHaveBeenCalledWith({ ...entryRoute(makeOcc()), replace: true })
  })

  it('docks to the top edge only on desktop with a non-empty query', () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    setMobile(false)
    const { container } = renderSearchBar()

    expect(container.querySelector('.z-30')).toHaveClass('fixed')
  })

  it('does not dock on mobile even with a query', () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    setMobile(true)
    const { container } = renderSearchBar()

    expect(container.querySelector('.z-30')).not.toHaveClass('fixed')
  })

  it('does not dock when the query is empty', () => {
    searchMock.mockReturnValue({ sq: '' })
    setMobile(false)
    const { container } = renderSearchBar()

    expect(container.querySelector('.z-30')).not.toHaveClass('fixed')
  })
})
