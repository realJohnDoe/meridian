// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as ReactRouter from '@tanstack/react-router'
import { render, screen, fireEvent } from '@testing-library/react'

const { navigateMock, backMock, pathnameRef } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  backMock: vi.fn(),
  pathnameRef: { current: '/settings' },
}))

// createFileRoute is mocked to hand back the component directly, same as
// __root.test.tsx — the real route is bound to the generated tree. Outlet
// needs router context this test doesn't set up, so it's stubbed too.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => opts,
    Outlet: () => <div data-testid="outlet" />,
    useNavigate: () => navigateMock,
    useRouter: () => ({ history: { back: backMock } }),
    useRouterState: <T,>({ select }: { select: (s: { location: { pathname: string } }) => T }) =>
      select({ location: { pathname: pathnameRef.current } }),
  }
})

vi.mock('@/store', () => ({ useStore: (selector: (s: { vaults: never[] }) => unknown) => selector({ vaults: [] }) }))

const { Route } = await import('./settings')
const SettingsLayout = (Route as unknown as { component: () => React.ReactElement }).component

beforeEach(() => {
  navigateMock.mockClear()
  backMock.mockClear()
  pathnameRef.current = '/settings'
})

describe('SettingsLayout back button', () => {
  it('pops history for a sub-screen reached from the list, same as the browser back button', () => {
    pathnameRef.current = '/settings'
    const { rerender } = render(<SettingsLayout />)

    // Simulate the in-app navigation list -> appearance (a push, observed here as a rerender).
    pathnameRef.current = '/settings/appearance'
    rerender(<SettingsLayout />)

    fireEvent.click(screen.getByTitle('Back'))

    expect(backMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('navigates to the list explicitly for a sub-screen reached without it in history (deep link / fresh load)', () => {
    pathnameRef.current = '/settings/vault/some-vault'
    render(<SettingsLayout />)

    fireEvent.click(screen.getByTitle('Back'))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings' })
    expect(backMock).not.toHaveBeenCalled()
  })

  it('pops history at the list root when there is history to pop', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2)
    pathnameRef.current = '/settings'
    render(<SettingsLayout />)

    fireEvent.click(screen.getByTitle('Back'))

    expect(backMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
