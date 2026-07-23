// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToday } from './useToday'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 15, 10, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useToday', () => {
  it('keeps the same Date reference across a visibilitychange within the same day', () => {
    const { result } = renderHook(() => useToday())
    const first = result.current

    act(() => { document.dispatchEvent(new Event('visibilitychange')) })

    expect(result.current).toBe(first)
  })

  it('returns a new Date once the calendar day has actually advanced', () => {
    const { result } = renderHook(() => useToday())
    const first = result.current

    vi.setSystemTime(new Date(2026, 5, 16, 10, 0, 0))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })

    expect(result.current).not.toBe(first)
    expect(result.current.getDate()).toBe(16)
  })

  it('rolls over via the scheduled midnight timeout, not just visibilitychange', async () => {
    const { result } = renderHook(() => useToday())
    const first = result.current

    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000) })

    expect(result.current).not.toBe(first)
    expect(result.current.getDate()).toBe(16)
  })
})
