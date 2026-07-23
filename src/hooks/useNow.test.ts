// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNow } from './useNow'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 15, 10, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNow', () => {
  it('ticks on the given interval when enabled', async () => {
    const { result } = renderHook(() => useNow(60_000))
    const first = result.current

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(result.current).not.toBe(first)
    expect(result.current.getMinutes()).toBe(1)
  })

  it('never ticks when disabled, staying frozen at mount', async () => {
    const { result } = renderHook(() => useNow(60_000, false))
    const first = result.current

    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(result.current).toBe(first)
  })

  it('starts ticking once enabled flips to true', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useNow(60_000, enabled), { initialProps: { enabled: false } })
    const first = result.current

    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(result.current).toBe(first) // still frozen while disabled

    rerender({ enabled: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(result.current).not.toBe(first)
  })
})
