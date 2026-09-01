// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { setupStore } from '@/test-utils'
import { chunkIndexFor } from './agendaChunks'
import {
  calendarView, resetCalendarViewState, requestScrollToDate,
  useAgendaLoadedRun, useAgendaLoadedChunks, MAX_LOADED_CHUNKS,
  growAgendaLoadedChunksForward, growAgendaLoadedChunksBackward,
} from './viewState'

setupStore()

const WS = 1

describe('useAgendaLoadedRun', () => {
  it('seeds three chunks around the anchor — the one containing it plus one on each side', () => {
    const anchor = new Date(2026, 5, 15)
    const anchorChunk = chunkIndexFor(anchor, WS)

    const { result } = renderHook(() => useAgendaLoadedRun(anchor, WS))

    expect(result.current).toEqual({ first: anchorChunk - 1, last: anchorChunk + 1 })
    expect(calendarView.getState().agendaLoadedChunks).toEqual(result.current)
  })

  it('does not reseed on a later call with the same or a different anchor once seeded', () => {
    const anchor = new Date(2026, 5, 15)
    const { result, rerender } = renderHook(({ a }: { a: Date }) => useAgendaLoadedRun(a, WS), {
      initialProps: { a: anchor },
    })
    const seeded = result.current

    // A plain re-render with a different anchor does *not* re-center the
    // run — only requestScrollToDate/resetCalendarViewState (which clear
    // agendaLoadedChunks back to null) trigger a reseed. This mirrors how
    // AgendaView is actually driven: `anchor` only changes in production
    // alongside one of those resets.
    rerender({ a: new Date(2026, 6, 20) })

    expect(result.current).toEqual(seeded)
  })

  it('reseeds around the new anchor once agendaLoadedChunks is cleared back to null', () => {
    const anchor = new Date(2026, 5, 15)
    const { result, rerender } = renderHook(({ a }: { a: Date }) => useAgendaLoadedRun(a, WS), {
      initialProps: { a: anchor },
    })
    expect(result.current).not.toBeNull()

    // Cleared and re-rendered with the new anchor in the same act(): clearing
    // first in its own act() would re-render with the *old* anchor prop still
    // in place (rerender hasn't run yet) and reseed around that instead —
    // exactly the premature-reseed bug this hook has to avoid in production,
    // where requestScrollToDate changes agendaAnchor and clears
    // agendaLoadedChunks in one store write for the same reason.
    const jumpTarget = new Date(2026, 6, 20)
    act(() => {
      calendarView.setState({ agendaLoadedChunks: null })
      rerender({ a: jumpTarget })
    })

    const jumpChunk = chunkIndexFor(jumpTarget, WS)
    expect(result.current).toEqual({ first: jumpChunk - 1, last: jumpChunk + 1 })
  })
})

describe('growAgendaLoadedChunksForward / growAgendaLoadedChunksBackward', () => {
  it('bumps the forward edge by one chunk without moving the back edge', () => {
    calendarView.setState({ agendaLoadedChunks: { first: 10, last: 12 } })

    growAgendaLoadedChunksForward(100)

    expect(calendarView.getState().agendaLoadedChunks).toEqual({ first: 10, last: 13 })
  })

  it('bumps the backward edge by one chunk without moving the forward edge', () => {
    calendarView.setState({ agendaLoadedChunks: { first: 10, last: 12 } })

    growAgendaLoadedChunksBackward(-100)

    expect(calendarView.getState().agendaLoadedChunks).toEqual({ first: 9, last: 12 })
  })

  it('does not grow forward past maxLast', () => {
    calendarView.setState({ agendaLoadedChunks: { first: 10, last: 12 } })

    growAgendaLoadedChunksForward(12)

    expect(calendarView.getState().agendaLoadedChunks).toEqual({ first: 10, last: 12 })
  })

  it('does not grow backward past minFirst', () => {
    calendarView.setState({ agendaLoadedChunks: { first: 10, last: 12 } })

    growAgendaLoadedChunksBackward(10)

    expect(calendarView.getState().agendaLoadedChunks).toEqual({ first: 10, last: 12 })
  })

  it('no-ops before the run has been seeded', () => {
    calendarView.setState({ agendaLoadedChunks: null })

    growAgendaLoadedChunksForward(100)
    growAgendaLoadedChunksBackward(-100)

    expect(calendarView.getState().agendaLoadedChunks).toBeNull()
  })

  it('caps the loaded run, evicting from the opposite (far) end — never the end that just grew', () => {
    // Already at the cap, all loaded by scrolling forward.
    calendarView.setState({ agendaLoadedChunks: { first: 0, last: MAX_LOADED_CHUNKS - 1 } })

    growAgendaLoadedChunksForward(1000)

    const after = calendarView.getState().agendaLoadedChunks!
    // The forward edge actually advanced…
    expect(after.last).toBe(MAX_LOADED_CHUNKS)
    // …and the run stayed at the cap by trimming the back, not the front the
    // user just scrolled to.
    expect(after.last - after.first + 1).toBe(MAX_LOADED_CHUNKS)
    expect(after.first).toBe(1)
  })

  it('caps the loaded run in the other direction for backward growth', () => {
    calendarView.setState({ agendaLoadedChunks: { first: -(MAX_LOADED_CHUNKS - 1), last: 0 } })

    growAgendaLoadedChunksBackward(-1000)

    const after = calendarView.getState().agendaLoadedChunks!
    expect(after.first).toBe(-MAX_LOADED_CHUNKS)
    expect(after.last - after.first + 1).toBe(MAX_LOADED_CHUNKS)
    expect(after.last).toBe(-1)
  })
})

describe('useAgendaLoadedChunks', () => {
  it('starts null and reflects growth reactively', () => {
    calendarView.setState({ agendaLoadedChunks: null })
    const { result } = renderHook(() => useAgendaLoadedChunks())
    expect(result.current).toBeNull()

    act(() => { calendarView.setState({ agendaLoadedChunks: { first: 0, last: 2 } }) })
    expect(result.current).toEqual({ first: 0, last: 2 })

    act(() => growAgendaLoadedChunksForward(100))
    expect(result.current).toEqual({ first: 0, last: 3 })
  })
})

describe('reseeding on reset/jump', () => {
  it('resetCalendarViewState clears the loaded run back to null', () => {
    calendarView.setState({ agendaLoadedChunks: { first: 0, last: 2 } })

    resetCalendarViewState()

    expect(calendarView.getState().agendaLoadedChunks).toBeNull()
  })

  it('requestScrollToDate clears the loaded run back to null, since it is centered on the old anchor', () => {
    calendarView.setState({ agendaLoadedChunks: { first: 0, last: 2 } })

    requestScrollToDate('2026-12-25')

    expect(calendarView.getState().agendaLoadedChunks).toBeNull()
  })
})
