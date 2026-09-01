// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { addDays } from 'date-fns'
import { renderHook } from '@testing-library/react'
import type { Occurrence } from '@/types'
import { makeOcc, makeRoots, setupStore, testKey, TEST_VAULT } from '@/test-utils'
import { agendaChunkRun, chunkIndexFor } from './agendaChunks'
import { useAgendaChunks } from './useAgendaChunks'
import type { AgendaChunkOccs } from './agendaSections'

setupStore()

/** Every occurrence in the run, ignoring which chunk it came out of. */
const flatten = (run: AgendaChunkOccs[]): Occurrence[] => run.flatMap(c => c.occs)

/** The run of chunk indices `radius` chunks out on each side of `anchor` — a
 * stand-in for whatever `calendar/viewState.ts`'s loaded-run state hands
 * `agendaChunkRun` in production; these tests only care that `useAgendaChunks`
 * reuses/evicts chunks correctly for a given index list, not how that list
 * was arrived at. */
function runAround(anchor: Date, ws: 0 | 1 | 6, radius = 2): number[] {
  const c = chunkIndexFor(anchor, ws)
  return agendaChunkRun({ first: c - radius, last: c + radius })
}

describe('useAgendaChunks', () => {
  it('reuses every chunk that still overlaps after the window shifts, e.g. a jump in from Month/Day view', () => {
    const anchor1 = new Date(2026, 5, 15)
    const roots = makeRoots('note.md')
    const items = [
      makeOcc({
        id: 'stays-in-both-windows', date: '2026-06-15', time: '09:00', entryKey: testKey('note.md'),
        metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Standup', tags: [], items: [], participants: [] },
      }),
    ]
    const ws = 1

    const { result, rerender } = renderHook(
      ({ indices }: { indices: number[] }) => useAgendaChunks(items, roots, indices, ws),
      { initialProps: { indices: runAround(anchor1, ws) } },
    )
    const occBefore = flatten(result.current).find(o => o.id === 'stays-in-both-windows')
    expect(occBefore).toBeDefined()

    // A jump a few weeks out (e.g. arriving from Month view) shifts the run
    // but leaves most of it overlapping — the old single-`(fromMs, toMs)`-keyed
    // cache (useExpandWithMultiday) would treat this as a full miss and
    // re-expand the whole span from scratch.
    const anchor2 = addDays(anchor1, 28)
    rerender({ indices: runAround(anchor2, ws) })
    const occAfter = flatten(result.current).find(o => o.id === 'stays-in-both-windows')

    // Reference-identical, not just value-equal: this occurrence's chunk was
    // never re-expanded, only reused from the cache under its own absolute
    // (anchor-independent) chunk index.
    expect(occAfter).toBe(occBefore)
  })

  it('hands back the very same run when the window is unchanged, so computeAgendaSections can skip entirely', () => {
    const anchor = new Date(2026, 5, 15)
    const roots = makeRoots('note.md')
    const items = [makeOcc({ id: 'a', date: '2026-06-15', time: '09:00', entryKey: testKey('note.md') })]
    const ws = 1

    const { result, rerender } = renderHook(
      ({ indices }: { indices: number[] }) => useAgendaChunks(items, roots, indices, ws),
      { initialProps: { indices: runAround(anchor, ws) } },
    )
    const first = result.current
    // Same items/roots identity, same chunk indices in a fresh array — an
    // unrelated re-render, not a data change.
    rerender({ indices: runAround(anchor, ws) })

    expect(result.current).toBe(first)
  })

  it('keeps each occurrence in its own chunk, ascending and disjoint', () => {
    const roots = makeRoots('note.md')
    const anchor = new Date(2026, 5, 15)
    const ws = 1
    const items = [
      makeOcc({ id: 'early', date: '2026-01-05', time: '09:00', entryKey: testKey('note.md') }),
      makeOcc({ id: 'late', date: '2026-06-15', time: '09:00', entryKey: testKey('note.md') }),
    ]

    // 2026-01-05 is ~160 days before the anchor — well past the default
    // radius, so widen the run to cover both occurrences' chunks.
    const { result } = renderHook(() => useAgendaChunks(items, roots, runAround(anchor, ws, 7), ws))

    const holders = result.current.filter(c => c.occs.length > 0)
    expect(holders.map(c => c.occs.map(o => o.id))).toEqual([['early'], ['late']])
    // Ascending — what lets the sectioning stage concatenate chunk rows with
    // no merge pass.
    expect(holders[0]!.index).toBeLessThan(holders[1]!.index)
  })
})
