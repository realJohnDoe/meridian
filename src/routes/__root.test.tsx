// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as ReactRouter from '@tanstack/react-router'
import { render, act } from '@testing-library/react'

const {
  restoreVaults, autoSyncTick, resetSyncBackoff, flushPendingPush, requestScrollToToday, setCurrentDate,
} = vi.hoisted(() => ({
  restoreVaults: vi.fn(),
  autoSyncTick: vi.fn(),
  resetSyncBackoff: vi.fn(),
  flushPendingPush: vi.fn(),
  requestScrollToToday: vi.fn(),
  setCurrentDate: vi.fn(),
}))

// createFileRoute is mocked to hand back the component directly — the real
// root route is bound to the generated tree. Outlet needs router context it
// would not have here, so it is stubbed too.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    createRootRoute: (opts: Record<string, unknown>) => ({ ...opts }),
    Outlet: () => <div data-testid="outlet" />,
  }
})

vi.mock('@/storage', () => ({ restoreVaults, autoSyncTick, resetSyncBackoff, flushPendingPush }))
vi.mock('@/calendar', () => ({ requestScrollToToday, setCurrentDate }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))

// The createRootRoute mock hands back the plain options object at runtime; the
// static type still describes the real RootRoute, which has no `component`.
const { Route } = await import('./__root')
const Root = (Route as unknown as { component: () => React.ReactElement }).component

/** Drives document.visibilityState, which is a read-only getter in jsdom. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  setVisibility('visible')
  vi.clearAllMocks()
})

afterEach(() => { vi.useRealTimers() })

describe('__root — startup', () => {
  it('restores saved vaults on mount', () => {
    render(<Root />)
    expect(restoreVaults).toHaveBeenCalledTimes(1)
  })

  it('renders the routed content', () => {
    const { getByTestId } = render(<Root />)
    expect(getByTestId('outlet')).toBeInTheDocument()
  })
})

describe('__root — background sync scheduling', () => {
  it('polls for sync every minute', () => {
    render(<Root />)
    expect(autoSyncTick).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(autoSyncTick).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(120_000) })
    expect(autoSyncTick).toHaveBeenCalledTimes(3)
  })

  it('stops polling once unmounted', () => {
    const { unmount } = render(<Root />)
    unmount()

    act(() => { vi.advanceTimersByTime(300_000) })

    expect(autoSyncTick).not.toHaveBeenCalled()
  })

  // Coming back online clears the backoff first, so the immediate retry is not
  // swallowed by a delay accumulated while the network was down.
  it('clears the sync backoff and retries when the network returns', () => {
    render(<Root />)

    act(() => { window.dispatchEvent(new Event('online')) })

    expect(resetSyncBackoff).toHaveBeenCalledTimes(1)
    expect(autoSyncTick).toHaveBeenCalledTimes(1)
  })

  it('ignores online events after unmount', () => {
    const { unmount } = render(<Root />)
    unmount()

    act(() => { window.dispatchEvent(new Event('online')) })

    expect(resetSyncBackoff).not.toHaveBeenCalled()
  })
})

describe('__root — going away', () => {
  // Best-effort flush so a backgrounded tab does not sit on dirty state for up
  // to a minute waiting for the next tick.
  it('flushes pending writes when the tab is hidden, without syncing', () => {
    render(<Root />)

    setVisibility('hidden')

    expect(flushPendingPush).toHaveBeenCalledTimes(1)
    expect(autoSyncTick).not.toHaveBeenCalled()
  })

  // visibilitychange is unreliable on teardown (notably iOS Safari), so
  // pagehide backs it up.
  it('also flushes on pagehide', () => {
    render(<Root />)

    act(() => { window.dispatchEvent(new Event('pagehide')) })

    expect(flushPendingPush).toHaveBeenCalledTimes(1)
  })

  it('stops flushing after unmount', () => {
    const { unmount } = render(<Root />)
    unmount()

    act(() => { window.dispatchEvent(new Event('pagehide')) })
    setVisibility('hidden')

    expect(flushPendingPush).not.toHaveBeenCalled()
  })
})

describe('__root — theme-color sync', () => {
  function withThemeColorMeta(initial = '#000000') {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', initial)
    document.head.appendChild(meta)
    return meta
  }

  afterEach(() => { document.querySelector('meta[name="theme-color"]')?.remove() })

  // Android colours the status bar from this meta tag, not from the page
  // background, so it has to track the active theme or it stays on the static
  // dark default from index.html.
  it('writes the resolved background colour into the theme-color meta tag', () => {
    const meta = withThemeColorMeta()
    document.documentElement.style.backgroundColor = 'rgb(1, 2, 3)'
    render(<Root />)

    act(() => { vi.advanceTimersByTime(32) })

    expect(meta.getAttribute('content')).toBe('rgb(1, 2, 3)')
  })

  // next-themes applies the theme class in its own effect on ThemeProvider,
  // which commits *after* this child effect. Reading the computed style
  // synchronously would therefore always see the previous theme — hence the
  // deferral to the next frame.
  it('defers the read to the next frame rather than reading during the effect', () => {
    const meta = withThemeColorMeta('#000000')
    document.documentElement.style.backgroundColor = 'rgb(1, 2, 3)'
    render(<Root />)

    expect(meta.getAttribute('content')).toBe('#000000')

    act(() => { vi.advanceTimersByTime(32) })

    expect(meta.getAttribute('content')).toBe('rgb(1, 2, 3)')
  })

  it('cancels the pending frame on unmount instead of writing after teardown', () => {
    const meta = withThemeColorMeta('#000000')
    document.documentElement.style.backgroundColor = 'rgb(1, 2, 3)'
    const { unmount } = render(<Root />)

    unmount()
    act(() => { vi.advanceTimersByTime(32) })

    expect(meta.getAttribute('content')).toBe('#000000')
  })

  it('does not throw when the page has no theme-color meta tag', () => {
    expect(() => {
      render(<Root />)
      act(() => { vi.advanceTimersByTime(32) })
    }).not.toThrow()
  })
})

describe('__root — resuming', () => {
  it('syncs when the tab becomes visible again', () => {
    render(<Root />)
    setVisibility('hidden')
    setVisibility('visible')

    expect(autoSyncTick).toHaveBeenCalledTimes(1)
  })

  it('does not re-scroll the agenda for an ordinary tab switch on the same day', () => {
    render(<Root />)

    setVisibility('hidden')
    setVisibility('visible')

    expect(requestScrollToToday).not.toHaveBeenCalled()
    expect(setCurrentDate).not.toHaveBeenCalled()
  })

  // Mobile PWAs freeze timers rather than reload, so a resume days later would
  // otherwise leave the agenda parked on a stale "today".
  it('re-scrolls to today when the calendar day changed while suspended', () => {
    vi.setSystemTime(new Date('2026-06-15T09:00:00'))
    render(<Root />)

    setVisibility('hidden')
    vi.setSystemTime(new Date('2026-06-18T09:00:00'))
    setVisibility('visible')

    expect(requestScrollToToday).toHaveBeenCalledTimes(1)
    // Resets the cross-view "current date" too, not just Agenda's own scroll
    // target — otherwise resuming on Month/Day would carry over a stale day.
    expect(setCurrentDate).toHaveBeenCalledWith('2026-06-18')
  })

  it('re-scrolls only once per day change, not on every subsequent resume', () => {
    vi.setSystemTime(new Date('2026-06-15T09:00:00'))
    render(<Root />)

    vi.setSystemTime(new Date('2026-06-18T09:00:00'))
    setVisibility('visible')
    setVisibility('visible')

    expect(requestScrollToToday).toHaveBeenCalledTimes(1)
    expect(setCurrentDate).toHaveBeenCalledTimes(1)
  })

  // Crossing midnight while merely backgrounded for a few minutes is still a
  // day change, and should behave the same as a multi-day suspend.
  it('treats a midnight crossing as a day change', () => {
    vi.setSystemTime(new Date('2026-06-15T23:58:00'))
    render(<Root />)

    vi.setSystemTime(new Date('2026-06-16T00:02:00'))
    setVisibility('visible')

    expect(requestScrollToToday).toHaveBeenCalledTimes(1)
    expect(setCurrentDate).toHaveBeenCalledWith('2026-06-16')
  })

  it('ignores a time change that stays inside the same day', () => {
    vi.setSystemTime(new Date('2026-06-15T09:00:00'))
    render(<Root />)

    vi.setSystemTime(new Date('2026-06-15T23:00:00'))
    setVisibility('visible')

    expect(requestScrollToToday).not.toHaveBeenCalled()
    expect(setCurrentDate).not.toHaveBeenCalled()
  })
})
