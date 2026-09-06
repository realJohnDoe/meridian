// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import type * as CalendarModule from '@/calendar'
import { useStore } from '@/store'
import { setupStore, testKey } from '@/test-utils'
import { SidebarProvider } from '@/components/ui/sidebar'
import type { Roots } from '@/types'
import AppSidebar from './-appSidebar'

const { navigateMock, requestScrollToDate } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  requestScrollToDate: vi.fn(),
}))

let pathname = '/'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: (opts: { select: (s: { location: { pathname: string } }) => string }) =>
      opts.select({ location: { pathname } }),
  }
})

vi.mock('@/calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof CalendarModule>()
  return { ...actual, useCurrentDate: () => '2026-06-15', requestScrollToDate }
})

setupStore()

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  )
}

beforeEach(() => {
  pathname = '/'
  navigateMock.mockClear()
  requestScrollToDate.mockClear()
})

describe('AppSidebar — calendar nav', () => {
  it('renders the four calendar views plus Backlog, Notes and Settings', () => {
    renderSidebar()
    for (const label of ['Agenda', 'Month', 'Week', 'Day', 'Backlog', 'Notes', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('marks Agenda active on "/" and nothing else', () => {
    pathname = '/'
    renderSidebar()

    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('data-active', 'false')
  })

  it('marks Day active for any /day/* route', () => {
    pathname = '/day/2026-06-15'
    renderSidebar()

    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('data-active', 'false')
  })

  it('navigates to Month, carrying the current month', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/calendar/$month', params: { month: '2026-06' } })
  })

  it('navigates to Week, carrying the current date', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/week/$date', params: { date: '2026-06-15' } })
  })

  it('navigates to Backlog and Notes', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/backlog' })

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/notes' })
  })

  it('navigates to Settings and marks it active under /settings', () => {
    pathname = '/settings'
    renderSidebar()

    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('data-active', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings' })
  })

  it('re-centers the agenda scroll only when switching in from elsewhere', () => {
    pathname = '/week/2026-06-15'
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }))

    expect(requestScrollToDate).toHaveBeenCalledWith('2026-06-15')
    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
  })

  it('does not re-scroll the agenda when already on it', () => {
    pathname = '/'
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }))

    expect(requestScrollToDate).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
  })
})

describe('AppSidebar — show tasks toggle', () => {
  it('reflects the store value and toggles it', () => {
    useStore.setState({ showTasks: true })
    renderSidebar()

    const checkbox = screen.getByRole('checkbox', { name: 'Show tasks on calendar' })
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    expect(useStore.getState().showTasks).toBe(false)
  })
})

describe('AppSidebar — favorites', () => {
  const KEY = testKey('note.md')
  const ROOTS: Roots = new Map([[KEY, { title: 'My Favorite Note', tags: [], items: [], vaultId: 'test-vault', fileSlug: 'note.md' }]])

  it('hides the Favorites group when there are none', () => {
    useStore.setState({ favorites: [] })
    renderSidebar()

    expect(screen.queryByText('Favorites')).not.toBeInTheDocument()
  })

  it('lists a favorite by its root title and navigates to it on click', () => {
    useStore.setState({ favorites: [KEY], roots: ROOTS })
    renderSidebar()

    expect(screen.getByText('My Favorite Note')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'My Favorite Note' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/entry/$vault/$slug', params: { vault: 'test-vault', slug: 'note.md' }, search: {} })
  })

  it('falls back to the raw entry key when the favorite has no root at all (e.g. a stale favorite)', () => {
    useStore.setState({ favorites: [KEY], roots: new Map() })
    renderSidebar()

    expect(screen.getByText(KEY)).toBeInTheDocument()
  })

  it('enters edit mode and offers reorder/remove controls instead of a nav link', () => {
    useStore.setState({ favorites: [KEY], roots: ROOTS })
    renderSidebar()

    fireEvent.click(screen.getByRole('button', { name: 'Reorder or remove favorites' }))

    expect(screen.queryByRole('button', { name: 'My Favorite Note' })).not.toBeInTheDocument()
    expect(screen.getByText('My Favorite Note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done editing favorites' })).toBeInTheDocument()
  })

  it('reorders favorites via the move controls', () => {
    const key2 = testKey('other.md')
    useStore.setState({
      favorites: [KEY, key2],
      roots: new Map([...ROOTS, [key2, { title: 'Second Note', tags: [], items: [], vaultId: 'test-vault', fileSlug: 'other.md' }]]),
    })
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Reorder or remove favorites' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]!)
    expect(useStore.getState().favorites).toEqual([key2, KEY])
  })

  it('removes a favorite from the store on click', () => {
    useStore.setState({ favorites: [KEY], roots: ROOTS })
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Reorder or remove favorites' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove from favorites' }))

    expect(useStore.getState().favorites).not.toContain(KEY)
  })

  it('exits edit mode via the Done button', () => {
    useStore.setState({ favorites: [KEY], roots: ROOTS })
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Reorder or remove favorites' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done editing favorites' }))

    expect(screen.getByRole('button', { name: 'My Favorite Note' })).toBeInTheDocument()
  })
})
