// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore, makeOcc } from '@/test-utils'
import { useFilteredOccs } from './useCalendarFilter'

setupStore()

describe('useFilteredOccs', () => {
  it('returns a stable reference across re-renders when occs is unchanged, even with an active participant filter', () => {
    useStore.setState({ participantFilter: ['alice'] })
    const occs = [makeOcc({ metadata: { participants: ['alice'], title: 'Standup', tags: [], items: [] } })]

    const { result, rerender } = renderHook(() => useFilteredOccs(occs))
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })

  it('recomputes when occs changes, applying the current filter', () => {
    useStore.setState({ participantFilter: ['alice'] })
    const withAlice = [makeOcc({ id: 'a', metadata: { participants: ['alice'], title: 'Standup', tags: [], items: [] } })]
    const withBob    = [makeOcc({ id: 'b', metadata: { participants: ['bob'],   title: '1:1',     tags: [], items: [] } })]

    const { result, rerender } = renderHook(({ occs }) => useFilteredOccs(occs), { initialProps: { occs: withAlice } })
    expect(result.current).toHaveLength(1)

    rerender({ occs: withBob })
    expect(result.current).toHaveLength(0)
  })

  it('filters out tasks when showTasks is off', () => {
    useStore.setState({ showTasks: false })
    const task  = makeOcc({ id: 't', metadata: { participants: [], title: 'Task', tags: [], items: [], done: false } })
    const event = makeOcc({ id: 'e', metadata: { participants: [], title: 'Event', tags: [], items: [] } })

    const { result } = renderHook(() => useFilteredOccs([task, event]))

    expect(result.current.map(o => o.id)).toEqual(['e'])
  })
})
