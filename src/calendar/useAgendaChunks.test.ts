// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { addDays } from 'date-fns'
import { renderHook } from '@testing-library/react'
import { dayRange } from '@/model'
import { makeOcc, makeRoots, setupStore, testKey, TEST_VAULT } from '@/test-utils'
import { useAgendaChunks } from './useAgendaChunks'

setupStore()

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

    const window1 = dayRange(addDays(anchor1, -365), addDays(anchor1, 90))
    const { result, rerender } = renderHook(
      ({ from, to }: { from: Date; to: Date }) => useAgendaChunks(items, roots, from, to, ws),
      { initialProps: window1 },
    )
    const before = result.current
    const occBefore = before.find(o => o.id === 'stays-in-both-windows')
    expect(occBefore).toBeDefined()

    // A jump a few weeks out (e.g. arriving from Month view) shifts the window
    // but leaves most of it overlapping — the old single-`(fromMs, toMs)`-keyed
    // cache (useExpandWithMultiday) would treat this as a full miss and
    // re-expand the whole span from scratch.
    const anchor2 = addDays(anchor1, 28)
    const window2 = dayRange(addDays(anchor2, -365), addDays(anchor2, 90))
    rerender(window2)
    const after = result.current
    const occAfter = after.find(o => o.id === 'stays-in-both-windows')

    // Reference-identical, not just value-equal: this occurrence's chunk was
    // never re-expanded, only reused from the cache under its own absolute
    // (anchor-independent) chunk index.
    expect(occAfter).toBe(occBefore)
  })

  it('hands back the very same concatenated array when the window is unchanged, so computeAgendaSections can skip entirely', () => {
    const anchor = new Date(2026, 5, 15)
    const roots = makeRoots('note.md')
    const items = [makeOcc({ id: 'a', date: '2026-06-15', time: '09:00', entryKey: testKey('note.md') })]
    const ws = 1
    const window = dayRange(addDays(anchor, -365), addDays(anchor, 90))

    const { result, rerender } = renderHook(
      ({ from, to }: { from: Date; to: Date }) => useAgendaChunks(items, roots, from, to, ws),
      { initialProps: window },
    )
    const first = result.current
    // Same items/roots identity, same (from, to) values (fresh Date objects,
    // same instants) — an unrelated re-render, not a data change.
    rerender({ from: new Date(window.from), to: new Date(window.to) })

    expect(result.current).toBe(first)
  })
})
