// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useShellMode, type ShellMode } from './use-shell-mode'

// The flow shell releases the document's overflow. If `data-shell` ever
// outlived the entry routes, a calendar route would inherit that: its panes
// would stop clipping, and the virtualizer's scroll element — which it measures
// through getScrollElement — would never scroll again. So what matters is not
// just that the attribute gets set, but that it always comes back off.

afterEach(() => { document.documentElement.removeAttribute('data-shell') })

const shell = () => document.documentElement.getAttribute('data-shell')

// Widens past `as const`, so rerender() can pass the other mode.
const props = (m: ShellMode) => ({ m })

describe('useShellMode', () => {
  it('marks the document for the flow shell', () => {
    renderHook(() => useShellMode('flow'))
    expect(shell()).toBe('flow')
  })

  it('leaves no attribute for the default fixed shell', () => {
    renderHook(() => useShellMode('fixed'))
    expect(shell()).toBeNull()
  })

  it('clears the attribute when switching back to fixed', () => {
    const { rerender } = renderHook(({ m }: { m: ShellMode }) => useShellMode(m), {
      initialProps: props('flow'),
    })
    expect(shell()).toBe('flow')
    rerender(props('fixed'))
    expect(shell()).toBeNull()
  })

  it('clears the attribute on unmount', () => {
    // The leak that matters most: navigating away from an entry route unmounts
    // the hook rather than re-rendering it with a new mode.
    const { unmount } = renderHook(() => useShellMode('flow'))
    expect(shell()).toBe('flow')
    unmount()
    expect(shell()).toBeNull()
  })

  it('survives a flow → fixed → flow round trip', () => {
    // Entry → agenda → entry, the sequence a real session repeats constantly.
    const { rerender } = renderHook(({ m }: { m: ShellMode }) => useShellMode(m), {
      initialProps: props('flow'),
    })
    rerender(props('fixed'))
    rerender(props('flow'))
    expect(shell()).toBe('flow')
    rerender(props('fixed'))
    expect(shell()).toBeNull()
  })
})
