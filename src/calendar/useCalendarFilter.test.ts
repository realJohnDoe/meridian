// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore, makeOcc, TEST_VAULT } from '@/test-utils'
import { useFilteredOccs, useParticipantFilteredOccs, NO_PARTICIPANT } from './useCalendarFilter'

setupStore()

describe('useFilteredOccs', () => {
  it('returns a stable reference across re-renders when occs is unchanged, even with an active participant filter', () => {
    useStore.setState({ participantFilter: ['alice'] })
    const occs = [makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: ['alice'], title: 'Standup', tags: [], items: [] } })]

    const { result, rerender } = renderHook(() => useFilteredOccs(occs))
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })

  it('recomputes when occs changes, applying the current filter', () => {
    useStore.setState({ participantFilter: ['alice'] })
    const withAlice = [makeOcc({ id: 'a', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: ['alice'], title: 'Standup', tags: [], items: [] } })]
    const withBob    = [makeOcc({ id: 'b', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: ['bob'],   title: '1:1',     tags: [], items: [] } })]

    const { result, rerender } = renderHook(({ occs }) => useFilteredOccs(occs), { initialProps: { occs: withAlice } })
    expect(result.current).toHaveLength(1)

    rerender({ occs: withBob })
    expect(result.current).toHaveLength(0)
  })

  it('filters out tasks when showTasks is off', () => {
    useStore.setState({ showTasks: false })
    const task  = makeOcc({ id: 't', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Task', tags: [], items: [], done: false } })
    const event = makeOcc({ id: 'e', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Event', tags: [], items: [] } })

    const { result } = renderHook(() => useFilteredOccs([task, event]))

    expect(result.current.map(o => o.id)).toEqual(['e'])
  })
})

describe('useParticipantFilteredOccs', () => {
  it('ignores showTasks — a hidden-tasks calendar must not blank the backlog', () => {
    useStore.setState({ showTasks: false, participantFilter: [] })
    const task = makeOcc({ id: 't', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Task', tags: [], items: [], done: false } })

    const { result } = renderHook(() => useParticipantFilteredOccs([task]))

    expect(result.current.map(o => o.id)).toEqual(['t'])
  })

  it('applies the participant filter', () => {
    useStore.setState({ showTasks: false, participantFilter: ['alice'] })
    const mine   = makeOcc({ id: 'a', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: ['alice'], title: 'Mine', tags: [], items: [], done: false } })
    const theirs = makeOcc({ id: 'b', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: ['bob'],   title: 'Theirs', tags: [], items: [], done: false } })

    const { result } = renderHook(() => useParticipantFilteredOccs([mine, theirs]))

    expect(result.current.map(o => o.id)).toEqual(['a'])
  })

  it('matches unassigned items via NO_PARTICIPANT', () => {
    useStore.setState({ showTasks: true, participantFilter: [NO_PARTICIPANT] })
    const none = makeOcc({ id: 'n', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [],        title: 'Loose', tags: [], items: [], done: false } })
    const some = makeOcc({ id: 's', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: ['alice'], title: 'Owned', tags: [], items: [], done: false } })

    const { result } = renderHook(() => useParticipantFilteredOccs([none, some]))

    expect(result.current.map(o => o.id)).toEqual(['n'])
  })
})
