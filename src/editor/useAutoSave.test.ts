// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useAutoSave } from './useAutoSave'
import { flushActiveAutoSave } from '@/autoSaveFlushPort'
import type { EntryState } from './state'

function useTestAutoSave(editScope: EntryState['editScope'] = 'all') {
  const commit = vi.fn()
  const entryRef = useRef({ editScope, body: '' } as unknown as EntryState)
  const hook = useAutoSave(commit, entryRef, '')
  return { commit, ...hook }
}

describe('autosave durability at teardown', () => {
  it('commits a pending autosave when the app-root teardown port fires', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTestAutoSave())

    act(() => { result.current.scheduleAutoSave('the user just typed this') })
    expect(result.current.commit).not.toHaveBeenCalled()

    // The signal __root.tsx forwards on pagehide/visibilitychange — not a
    // window event dispatched straight at this hook, since it registers no
    // listener of its own (see autoSaveFlushPort.ts).
    act(() => { flushActiveAutoSave() })

    expect(result.current.commit).toHaveBeenCalledTimes(1)
    expect(result.current.commit).toHaveBeenCalledWith(expect.objectContaining({ body: 'the user just typed this' }))
    vi.useRealTimers()
  })

  it('is a no-op when nothing is pending', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTestAutoSave())

    act(() => { flushActiveAutoSave() })

    expect(result.current.commit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not register a flush for a brand-new, unsaved draft', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTestAutoSave('add'))

    act(() => { result.current.scheduleAutoSave('typed into a new draft') })
    act(() => { flushActiveAutoSave() })

    expect(result.current.commit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('unregisters on unmount, so a later teardown signal does not call a stale commit', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useTestAutoSave())

    act(() => { result.current.scheduleAutoSave('will be flushed by unmount itself') })
    unmount()
    result.current.commit.mockClear()

    act(() => { flushActiveAutoSave() })

    expect(result.current.commit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('the latest editor mounted wins the port, not the first', () => {
    vi.useFakeTimers()
    const first = renderHook(() => useTestAutoSave())
    const second = renderHook(() => useTestAutoSave())

    act(() => { first.result.current.scheduleAutoSave('from the first editor') })
    act(() => { second.result.current.scheduleAutoSave('from the second editor') })

    act(() => { flushActiveAutoSave() })

    expect(second.result.current.commit).toHaveBeenCalledTimes(1)
    expect(first.result.current.commit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
