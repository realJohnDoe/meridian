// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { SidebarProvider } from '@/components/ui/sidebar'
import { setMediaQuery, setupStore, makeOcc } from '@/test-utils'
import { setCurrentDate } from '@/calendar'
import { fmtISO } from '@/model'
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
  SearchOverlay: ({ query, onClose, onCreate, onOpen, highlightedIndex, onRowsChange, activeDescendantId }: {
    query: string
    onClose: () => void
    onCreate: (title: string) => void
    onOpen: (occ: ReturnType<typeof makeOcc>) => void
    highlightedIndex: number
    onRowsChange: (rows: { id: string; entryKey: string | null; activate: () => void }[], defaultIndex: number) => void
    activeDescendantId?: string
  }) => (
    <div data-testid="search-overlay">
      <span data-testid="overlay-query">{query}</span>
      <span data-testid="overlay-highlighted-index">{highlightedIndex}</span>
      <span data-testid="overlay-active-id">{activeDescendantId}</span>
      <button type="button" onClick={onClose}>overlay-close</button>
      <button type="button" onClick={() => onCreate('typed title')}>overlay-create</button>
      <button type="button" onClick={() => onOpen(makeOcc())}>overlay-open</button>
      {/* Stands in for SearchResults reporting a Create row plus one matching result — enough for the keyboard-nav tests to drive ArrowDown/ArrowUp/Enter against real rows instead of the empty-rows fallback. */}
      <button
        type="button"
        onClick={() => onRowsChange(
          [
            { id: 'search-option-create', entryKey: null, activate: () => onCreate(query) },
            { id: 'search-option-note', entryKey: 'note', activate: () => onOpen(makeOcc()) },
          ],
          0,
        )}
      >overlay-report-rows</button>
    </div>
  ),
}))

// Future so it survives the "never default to a past date" clamp unchanged.
const FUTURE = '2999-06-15'

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
  setCurrentDate(FUTURE)
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

    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute(undefined, { date: FUTURE }), replace: false })
  })

  it('defaults a new entry to today, not a past date the view is scrolled to', () => {
    setCurrentDate('2020-01-01')
    renderSearchBar()
    fireEvent.click(screen.getByRole('button', { name: 'New entry' }))

    const { date } = (navigateMock.mock.calls[0]![0] as { search: { date: string } }).search
    expect(date).toBe(fmtISO(new Date()))
  })
})

describe('SearchBar — open state', () => {
  it('shows the overlay once sq is present, even as an empty string', async () => {
    searchMock.mockReturnValue({ sq: '' })
    renderSearchBar()

    expect(await screen.findByTestId('search-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('overlay-query')).toHaveTextContent('')
  })

  it('focuses the docked field on desktop once search opens, for opens that were not a click (e.g. a keyboard shortcut)', () => {
    searchMock.mockReturnValue({ sq: '' })
    setMobile(false)
    renderSearchBar()

    expect(screen.getByPlaceholderText('Search or create…')).toHaveFocus()
  })

  it('does not steal focus on mobile — the full-screen overlay focuses its own field', () => {
    searchMock.mockReturnValue({ sq: '' })
    setMobile(true)
    renderSearchBar()

    expect(screen.getByPlaceholderText('Search or create…')).not.toHaveFocus()
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
    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute('groceries', { date: FUTURE }), replace: true })
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

    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute('groceries', { date: FUTURE }), replace: true })
  })

  it('forwards the overlay\'s create and close callbacks', async () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()
    await screen.findByTestId('search-overlay')

    fireEvent.click(screen.getByRole('button', { name: 'overlay-create' }))
    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute('typed title', { date: FUTURE }), replace: true })

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

  it('activates the highlighted row on Enter instead of always creating (issue #1124)', async () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()
    await screen.findByTestId('search-overlay')

    fireEvent.click(screen.getByRole('button', { name: 'overlay-report-rows' }))
    expect(screen.getByTestId('overlay-highlighted-index')).toHaveTextContent('0')

    // Default highlight is the Create row (index 0); ArrowDown moves to the
    // one reported result (index 1) without touching the input's own value.
    fireEvent.keyDown(screen.getByPlaceholderText('Search or create…'), { key: 'ArrowDown' })
    expect(screen.getByTestId('overlay-highlighted-index')).toHaveTextContent('1')
    expect(screen.getByTestId('overlay-active-id')).toHaveTextContent('search-option-note')

    navigateMock.mockClear()
    fireEvent.keyDown(screen.getByPlaceholderText('Search or create…'), { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith({ ...entryRoute(makeOcc()), replace: true })
  })

  it('ArrowUp does not move past the first row', async () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()
    await screen.findByTestId('search-overlay')

    fireEvent.click(screen.getByRole('button', { name: 'overlay-report-rows' }))
    fireEvent.keyDown(screen.getByPlaceholderText('Search or create…'), { key: 'ArrowUp' })

    expect(screen.getByTestId('overlay-highlighted-index')).toHaveTextContent('0')
  })

  it('still creates on Enter when the highlighted row is the Create row', async () => {
    searchMock.mockReturnValue({ sq: 'groceries' })
    renderSearchBar()
    await screen.findByTestId('search-overlay')

    fireEvent.click(screen.getByRole('button', { name: 'overlay-report-rows' }))
    fireEvent.keyDown(screen.getByPlaceholderText('Search or create…'), { key: 'Enter' })

    expect(navigateMock).toHaveBeenCalledWith({ ...newEntryRoute('groceries', { date: FUTURE }), replace: true })
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
