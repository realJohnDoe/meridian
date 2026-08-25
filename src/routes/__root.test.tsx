// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as ReactRouter from '@tanstack/react-router'
import { render, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const {
  restoreVaults, autoSyncTick, resetSyncBackoff, flushPendingPush, requestScrollToToday, setCurrentDate,
  resetCalendarOnVaultChange, onVaultChanged, triggerVaultChanged,
} = vi.hoisted(() => {
  const listeners = new Set<(change: { contentReplaced: boolean }) => void>()
  return {
    restoreVaults: vi.fn(),
    autoSyncTick: vi.fn(),
    resetSyncBackoff: vi.fn(),
    flushPendingPush: vi.fn(),
    requestScrollToToday: vi.fn(),
    setCurrentDate: vi.fn(),
    resetCalendarOnVaultChange: vi.fn(),
    onVaultChanged: vi.fn((fn: (change: { contentReplaced: boolean }) => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }),
    triggerVaultChanged: (change: { contentReplaced: boolean }) => { listeners.forEach(fn => fn(change)) },
  }
})

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

vi.mock('@/storage', () => ({ restoreVaults, autoSyncTick, resetSyncBackoff, flushPendingPush, onVaultChanged }))
vi.mock('@/calendar', () => ({ requestScrollToToday, setCurrentDate, resetCalendarOnVaultChange }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))

// The createRootRoute mock hands back the plain options object at runtime; the
// static type still describes the real RootRoute, which has no `component`.
const { Route, THEME_CLASS, THEME_IDS } = await import('./__root')
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
  const BACKGROUND_DARK = 'oklch(0.18 0.05 252)'  // -> #011227
  const BACKGROUND_LIGHT = 'oklch(0.945 0.010 252)' // -> #e8edf4
  const PALETTE: Record<string, [number, number, number]> = {
    '#ff00ff':           [255, 0, 255],   // toHex's parse probe
    [BACKGROUND_DARK]:   [1, 18, 39],
    [BACKGROUND_LIGHT]:  [232, 237, 244],
  }

  /**
   * jsdom ships no canvas, so toHex()'s 1x1 readback needs a stand-in. Models
   * the two behaviours it leans on: an unparseable fillStyle is silently
   * ignored (the previous value survives), and the filled pixel reads back as
   * 8-bit sRGB.
   */
  function stubCanvas() {
    let fill = '#000000'
    const ctx = {
      get fillStyle() { return fill },
      set fillStyle(v: string) { if (v in PALETTE) fill = v },
      fillRect: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([...(PALETTE[fill] ?? [0, 0, 0]), 255]) }),
    }
    return vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  }

  /** The static fallback tags index.html ships, in their shipped order. */
  function withStaticTags() {
    const specs = [
      { content: '#011227', media: '(prefers-color-scheme: dark)' },
      { content: '#e8edf4', media: '(prefers-color-scheme: light)' },
      { content: '#011227', media: null },
    ]
    return specs.map(({ content, media }) => {
      const meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      meta.setAttribute('content', content)
      if (media) meta.setAttribute('media', media)
      document.head.appendChild(meta)
      return meta
    })
  }

  const allTags = () => [...document.querySelectorAll('meta[name="theme-color"]')]
  const syncedTag = () => document.querySelector('meta[name="theme-color"][data-theme-synced]')

  let canvasSpy: ReturnType<typeof stubCanvas>
  beforeEach(() => { canvasSpy = stubCanvas() })
  afterEach(() => {
    canvasSpy.mockRestore()
    allTags().forEach(m => { m.remove() })
    document.documentElement.style.removeProperty('--background')
  })

  it('writes the active theme --background into a theme-color tag', () => {
    withStaticTags()
    document.documentElement.style.setProperty('--background', BACKGROUND_DARK)
    render(<Root />)

    act(() => { vi.advanceTimersByTime(32) })

    expect(syncedTag()?.getAttribute('content')).toBe('#011227')
  })

  // The invariant the whole approach rests on. The UA returns the FIRST
  // theme-color element in tree order whose media matches, so a synced tag
  // appended after the static ones would never be consulted whenever a
  // prefers-color-scheme query matches — i.e. precisely when the chosen theme
  // disagrees with the system appearance, the case this exists to handle.
  it('inserts its tag ahead of the static fallbacks in tree order', () => {
    const statics = withStaticTags()
    document.documentElement.style.setProperty('--background', BACKGROUND_LIGHT)
    render(<Root />)

    act(() => { vi.advanceTimersByTime(32) })

    const tags = allTags()
    expect(tags[0]).toBe(syncedTag())
    expect(tags.slice(1)).toEqual(statics)
    // and it must not carry a media attribute, or it could fail to match
    expect(syncedTag()?.hasAttribute('media')).toBe(false)
  })

  // The tag outlives any one mount, so a later run has to find and update it
  // rather than append a second — two synced tags would leave the stale one
  // first in tree order, and the UA would keep returning that.
  it('reuses its own tag on a later run instead of stacking up new ones', () => {
    withStaticTags()
    document.documentElement.style.setProperty('--background', BACKGROUND_DARK)
    const { unmount } = render(<Root />)
    act(() => { vi.advanceTimersByTime(32) })
    const first = syncedTag()
    unmount()

    document.documentElement.style.setProperty('--background', BACKGROUND_LIGHT)
    render(<Root />)
    act(() => { vi.advanceTimersByTime(32) })

    expect(document.querySelectorAll('meta[name="theme-color"][data-theme-synced]')).toHaveLength(1)
    expect(syncedTag()).toBe(first)
    expect(syncedTag()?.getAttribute('content')).toBe('#e8edf4')
  })

  // The static tags are the fallback layer; a colour we cannot resolve must
  // leave them in charge rather than publish an accidental black.
  it('creates no tag at all when the colour does not parse', () => {
    const statics = withStaticTags()
    document.documentElement.style.setProperty('--background', 'not-a-color')
    render(<Root />)

    act(() => { vi.advanceTimersByTime(32) })

    expect(syncedTag()).toBeNull()
    expect(allTags()).toEqual(statics)
  })

  // getComputedStyle round-trips oklch() rather than downgrading it to rgb().
  // oklch() is a valid CSS <color> and so spec-legal in `content`, but hex is
  // what every engine can actually read.
  it('normalizes the oklch() token to hex rather than writing it raw', () => {
    withStaticTags()
    document.documentElement.style.setProperty('--background', BACKGROUND_DARK)
    render(<Root />)

    act(() => { vi.advanceTimersByTime(32) })

    const content = syncedTag()?.getAttribute('content')
    expect(content).not.toContain('oklch')
    expect(content).toMatch(/^#[0-9a-f]{6}$/)
  })

  // next-themes applies the theme class in its own effect on ThemeProvider,
  // which commits *after* this child effect, so a synchronous read would see
  // the previous theme.
  it('defers the read to the next frame rather than reading during the effect', () => {
    withStaticTags()
    document.documentElement.style.setProperty('--background', BACKGROUND_DARK)
    render(<Root />)

    expect(syncedTag()).toBeNull()

    act(() => { vi.advanceTimersByTime(32) })

    expect(syncedTag()?.getAttribute('content')).toBe('#011227')
  })

  it('cancels the pending frame on unmount instead of writing after teardown', () => {
    withStaticTags()
    document.documentElement.style.setProperty('--background', BACKGROUND_DARK)
    const { unmount } = render(<Root />)

    unmount()
    act(() => { vi.advanceTimersByTime(32) })

    expect(syncedTag()).toBeNull()
  })

  // The tag is created on demand, so a page shipping none of the static ones
  // still gets a synced one rather than throwing.
  it('still works on a page with no static theme-color tags', () => {
    document.documentElement.style.setProperty('--background', BACKGROUND_DARK)
    render(<Root />)

    act(() => { vi.advanceTimersByTime(32) })

    expect(syncedTag()?.getAttribute('content')).toBe('#011227')
  })
})

describe('__root — vault-changed subscription', () => {
  // The regression PR 2 of plans/entry-layout-route.md would otherwise
  // introduce: the entry routes unmount whatever previously hosted this
  // subscription while the editor is open, so it has to live on the root
  // route, which stays mounted across every route. Root's Outlet is stubbed
  // to a plain div rather than the real agenda, standing in for any
  // non-agenda route — this must fire regardless.
  it('resets calendar view state on a vault change while the rendered route is not the agenda', () => {
    render(<Root />)

    triggerVaultChanged({ contentReplaced: true })

    expect(resetCalendarOnVaultChange).toHaveBeenCalledTimes(1)
  })

  it('ignores a vault change that did not replace content', () => {
    render(<Root />)

    triggerVaultChanged({ contentReplaced: false })

    expect(resetCalendarOnVaultChange).not.toHaveBeenCalled()
  })

  it('stops listening after unmount', () => {
    const { unmount } = render(<Root />)
    unmount()

    triggerVaultChanged({ contentReplaced: true })

    expect(resetCalendarOnVaultChange).not.toHaveBeenCalled()
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

describe('THEME_CLASS', () => {
  // Read the stylesheet as text: jsdom does not evaluate @import or resolve
  // Tailwind, so asserting on computed styles here would prove nothing. The
  // failure this guards is a theme id whose class was never authored (or was
  // renamed in index.css alone) — which shows up as a theme that silently
  // falls back to :root instead of throwing.
  // Resolved from the project root (vitest's cwd) rather than import.meta.url,
  // which is an http: URL under the jsdom environment.
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

  it.each(Object.entries(THEME_CLASS))('%s maps to a class defined in index.css', (_id, cls) => {
    expect(css).toContain(`.${cls} {`)
  })

  it('resolves prefers-color-scheme to the branded pair, not a borrowed palette', () => {
    expect(THEME_CLASS.light).toBe('meridian-light')
    expect(THEME_CLASS.dark).toBe('meridian')
  })

  it('exposes every theme except the two color-scheme aliases as selectable', () => {
    expect(THEME_IDS).not.toContain('light')
    expect(THEME_IDS).not.toContain('dark')
    expect(THEME_IDS).toContain('meridian')
    expect(THEME_IDS).toContain('meridian-light')
    expect(THEME_IDS).toHaveLength(Object.keys(THEME_CLASS).length - 2)
  })
})
