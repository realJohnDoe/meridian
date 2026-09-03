// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore, makeOcc, TEST_VAULT } from '@/test-utils'
import { useCalendarFilter, useFilteredOccs, useParticipantFilteredOccs, describeFilter, NO_PARTICIPANT } from './useCalendarFilter'

setupStore()

const OTHER_VAULT = 'other-vault'

function occIn(vaultId: string, id: string, participants: string[], extra: Record<string, unknown> = {}) {
  return makeOcc({
    id,
    metadata: { vaultId, fileSlug: 'note', participants, title: id, tags: [], items: [], ...extra },
  })
}

describe('useFilteredOccs', () => {
  it('returns a stable reference across re-renders when occs is unchanged, even with an active filter', () => {
    useStore.setState({ hiddenParticipants: { [TEST_VAULT]: ['bob'] } })
    const occs = [occIn(TEST_VAULT, 'a', ['alice'])]

    const { result, rerender } = renderHook(() => useFilteredOccs(occs))
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })

  it('recomputes when occs changes, applying the current filter', () => {
    useStore.setState({ hiddenParticipants: { [TEST_VAULT]: ['bob'] } })
    const withAlice = [occIn(TEST_VAULT, 'a', ['alice'])]
    const withBob   = [occIn(TEST_VAULT, 'b', ['bob'])]

    const { result, rerender } = renderHook(({ occs }) => useFilteredOccs(occs), { initialProps: { occs: withAlice } })
    expect(result.current).toHaveLength(1)

    rerender({ occs: withBob })
    expect(result.current).toHaveLength(0)
  })

  it('filters out tasks when showTasks is off', () => {
    useStore.setState({ showTasks: false })
    const task  = occIn(TEST_VAULT, 't', [], { done: false })
    const event = occIn(TEST_VAULT, 'e', [])

    const { result } = renderHook(() => useFilteredOccs([task, event]))

    expect(result.current.map(o => o.id)).toEqual(['e'])
  })

  it('hides a whole vault', () => {
    useStore.setState({ hiddenVaultIds: [OTHER_VAULT] })
    const mine   = occIn(TEST_VAULT,  'mine',  [])
    const theirs = occIn(OTHER_VAULT, 'theirs', [])

    const { result } = renderHook(() => useFilteredOccs([mine, theirs]))

    expect(result.current.map(o => o.id)).toEqual(['mine'])
  })

  // The reason `hiddenParticipants` is keyed by vault at all: two vaults can
  // each have a "Bob", and they are not the same person.
  it('hides a person in one vault while leaving the same name visible in another', () => {
    useStore.setState({ hiddenParticipants: { [TEST_VAULT]: ['bob'] } })
    const workBob     = occIn(TEST_VAULT,  'work-bob',     ['bob'])
    const personalBob = occIn(OTHER_VAULT, 'personal-bob', ['bob'])

    const { result } = renderHook(() => useFilteredOccs([workBob, personalBob]))

    expect(result.current.map(o => o.id)).toEqual(['personal-bob'])
  })

  // "Hidden", not "shown", is what makes this true — an inclusive filter would
  // have dropped both of these until someone ticked them.
  it('shows a newly appearing attendee and a newly registered vault by default', () => {
    useStore.setState({ hiddenParticipants: { [TEST_VAULT]: ['bob'] }, hiddenVaultIds: [] })
    const newPerson = occIn(TEST_VAULT,  'new-person', ['carol'])
    const newVault  = occIn('fresh-vault', 'new-vault', ['dave'])

    const { result } = renderHook(() => useFilteredOccs([newPerson, newVault]))

    expect(result.current.map(o => o.id)).toEqual(['new-person', 'new-vault'])
  })

  it('keeps an occurrence whose other participant is still visible', () => {
    useStore.setState({ hiddenParticipants: { [TEST_VAULT]: ['bob'] } })
    const shared = occIn(TEST_VAULT, 'shared', ['bob', 'alice'])

    const { result } = renderHook(() => useFilteredOccs([shared]))

    expect(result.current.map(o => o.id)).toEqual(['shared'])
  })

  it('hides unparticipated occurrences via the NO_PARTICIPANT sentinel, per vault', () => {
    useStore.setState({ hiddenParticipants: { [TEST_VAULT]: [NO_PARTICIPANT] } })
    const loose      = occIn(TEST_VAULT,  'loose',       [])
    const otherLoose = occIn(OTHER_VAULT, 'other-loose', [])

    const { result } = renderHook(() => useFilteredOccs([loose, otherLoose]))

    expect(result.current.map(o => o.id)).toEqual(['other-loose'])
  })

  // filterOccs no longer keys the agenda's caches (describeFilter does), but it
  // still feeds useMemo deps here and in the other views.
  it('keeps filterOccs referentially stable when no filter state changed', () => {
    useStore.setState({ hiddenVaultIds: [OTHER_VAULT], hiddenParticipants: { [TEST_VAULT]: ['bob'] } })
    const occs = [occIn(TEST_VAULT, 'a', ['alice'])]

    const { result, rerender } = renderHook(() => useFilteredOccs(occs))
    const first = result.current
    // A store write that touches nothing the filter reads.
    useStore.setState({ vaultLoading: false })
    rerender()

    expect(result.current).toBe(first)
  })

  it('recomputes when hiddenParticipants is replaced', () => {
    useStore.setState({ hiddenParticipants: {} })
    const occs = [occIn(TEST_VAULT, 'a', ['alice'])]

    const { result, rerender } = renderHook(() => useFilteredOccs(occs))
    expect(result.current).toHaveLength(1)

    useStore.setState({ hiddenParticipants: { [TEST_VAULT]: ['alice'] } })
    rerender()

    expect(result.current).toHaveLength(0)
  })

  // Archived is unconditional — no pref gates it, unlike showTasks.
  it('hides an archived occurrence', () => {
    const archived = occIn(TEST_VAULT, 'a', [], { archived: true })
    const active   = occIn(TEST_VAULT, 'b', [])

    const { result } = renderHook(() => useFilteredOccs([archived, active]))

    expect(result.current.map(o => o.id)).toEqual(['b'])
  })

  // hideVaults/hideParticipants both return their input by reference when
  // nothing is hidden, which is what lets a re-render with unchanged occs
  // skip work — hideArchived must keep that property once it's unconditionally
  // in the chain, or every call would allocate regardless of filter state.
  it('returns occs by reference when nothing is archived', () => {
    const occs = [occIn(TEST_VAULT, 'a', [])]

    const { result } = renderHook(() => useFilteredOccs(occs))

    expect(result.current).toBe(occs)
  })
})

describe('useParticipantFilteredOccs', () => {
  it('ignores showTasks — a hidden-tasks calendar must not blank the backlog', () => {
    useStore.setState({ showTasks: false, hiddenParticipants: {} })
    const task = occIn(TEST_VAULT, 't', [], { done: false })

    const { result } = renderHook(() => useParticipantFilteredOccs([task]))

    expect(result.current.map(o => o.id)).toEqual(['t'])
  })

  it('applies the people filter', () => {
    useStore.setState({ showTasks: false, hiddenParticipants: { [TEST_VAULT]: ['bob'] } })
    const mine   = occIn(TEST_VAULT, 'a', ['alice'], { done: false })
    const theirs = occIn(TEST_VAULT, 'b', ['bob'],   { done: false })

    const { result } = renderHook(() => useParticipantFilteredOccs([mine, theirs]))

    expect(result.current.map(o => o.id)).toEqual(['a'])
  })

  // Hiding a calendar means hiding it everywhere, lists included.
  it('applies the vault filter', () => {
    useStore.setState({ showTasks: false, hiddenVaultIds: [OTHER_VAULT] })
    const mine   = occIn(TEST_VAULT,  'a', [], { done: false })
    const theirs = occIn(OTHER_VAULT, 'b', [], { done: false })

    const { result } = renderHook(() => useParticipantFilteredOccs([mine, theirs]))

    expect(result.current.map(o => o.id)).toEqual(['a'])
  })

  // The leg this hook and filterOccs share (hideEverywhere) — pinned here so
  // adding it to only one of the two silently misses the Backlog/Notes case.
  it('hides an archived entry, same as the calendar', () => {
    const archived = occIn(TEST_VAULT, 'a', [], { done: false, archived: true })
    const active   = occIn(TEST_VAULT, 'b', [], { done: false })

    const { result } = renderHook(() => useParticipantFilteredOccs([archived, active]))

    expect(result.current.map(o => o.id)).toEqual(['b'])
  })
})

describe('describeFilter', () => {
  it('describes equal filter state identically however the state was assembled', () => {
    expect(describeFilter(['b', 'a'], { [TEST_VAULT]: ['bob', 'alice'] }, true))
      .toBe(describeFilter(['a', 'b'], { [TEST_VAULT]: ['alice', 'bob'] }, true))
  })

  it('separates every axis it stands in for', () => {
    const base = describeFilter([], {}, true)
    expect(describeFilter([OTHER_VAULT], {}, true)).not.toBe(base)
    expect(describeFilter([], { [TEST_VAULT]: ['bob'] }, true)).not.toBe(base)
    expect(describeFilter([], {}, false)).not.toBe(base)
    // Two vaults can each hide a different "Bob" — the vault the name is
    // hidden in is part of the state, not just the name.
    expect(describeFilter([], { [TEST_VAULT]: ['bob'] }, true))
      .not.toBe(describeFilter([], { [OTHER_VAULT]: ['bob'] }, true))
  })

  // This is what the agenda's per-chunk section caches key on, so a filter
  // change that left the key equal would serve stale rows.
  it('changes with the filter it describes, and only with it', () => {
    useStore.setState({ hiddenVaultIds: [], hiddenParticipants: {}, showTasks: true })
    const { result, rerender } = renderHook(() => useCalendarFilter().filterKey)
    const before = result.current

    useStore.setState({ vaultLoading: false })
    rerender()
    expect(result.current).toBe(before)

    useStore.setState({ showTasks: false })
    rerender()
    expect(result.current).not.toBe(before)
  })
})
