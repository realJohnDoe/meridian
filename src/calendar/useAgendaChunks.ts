import { useEffect } from 'react'
import type { StoreItem, Roots, Occurrence } from '@/types'
import { computeExpansionCache, type ExpansionCache } from '@/model'
import { chunkIndicesFor, chunkRange } from './agendaChunks'
import { agendaChunkCache } from './expansionCaches'

interface ConcatMemo {
  indices: number[]
  chunks: ExpansionCache[]
  allOccs: Occurrence[]
}

// Single-slot, same reasoning as useAgendaSections' own cache slots: the
// agenda is a singleton view, so one memoized concatenation is enough.
const CONCAT_KEY = 'agenda'
const concatSlot = new Map<typeof CONCAT_KEY, ConcatMemo>()

function sameIndices(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function sameChunks(a: ExpansionCache[], b: ExpansionCache[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * The agenda's own chunked expansion: `[from, to]` is covered by a run of
 * fixed, disjoint 28-day chunks (agendaChunks.ts), each expanded and cached
 * independently — so widening the window (a jump in from Month/Day view, or a
 * future "load more") reuses every chunk that still overlaps instead of
 * re-expanding the whole span the way a single `(fromMs, toMs)`-keyed cache
 * would. See plans/agenda-infinite-scroll.md's PR 2.
 *
 * Deliberately not `useExpandWithMultiday`: that hook's `cacheByWindow` is an
 * LRU sized for Month/Day/Week's several concurrent panes
 * (`MAX_CACHED_WINDOWS`), and chunked scrolling would evict live chunks well
 * before that cap. `agendaChunkCache` (expansionCaches.ts) is this hook's own
 * map instead, with a genuinely different eviction policy. For now (PR 2) that
 * policy is simply "keep every chunk in the requested range, drop the rest" —
 * retention across loads is PR 4's problem.
 *
 * Every chunk's own `ExpansionCache` already carries the `(fromMs, toMs)` it
 * was built for (model/expansionCache.ts). A lookup that finds an entry whose
 * bounds don't match this chunk index's *current* range — only reachable if
 * the locale week-start changed, since that's the only thing that moves the
 * grid under a fixed index (agendaChunks.ts) — is treated as a miss and
 * recomputed rather than silently reused, and logged loudly in dev: reusing it
 * would resolve to a wrong chunk's occurrences with no other symptom.
 *
 * The concatenated result is itself memoized on the chunk list's identity, not
 * rebuilt fresh every render: `computeAgendaSections` short-circuits entirely
 * when its `allOccs` argument is reference-identical to last time, and a fresh
 * array here on every call (even when every chunk hit cache) would silently
 * lose that fast path.
 */
export function useAgendaChunks(
  items: StoreItem[],
  roots: Roots,
  from: Date,
  to: Date,
  ws: 0 | 1 | 6,
): Occurrence[] {
  const indices = chunkIndicesFor(from, to, ws)

  // Value writes, render phase. Safe here for the same reason
  // useExpandWithMultiday's own render-phase write is: computeExpansionCache
  // returns `reusable` by reference when nothing changed, so repeating this
  // (StrictMode double-render) or skipping it (React Compiler memoizing this
  // block) can't produce a wrong value.
  const chunks: ExpansionCache[] = []
  for (const index of indices) {
    const range = chunkRange(index, ws)
    const cached = agendaChunkCache.get(index) ?? null
    const reusable = cached && cached.fromMs === range.from.getTime() && cached.toMs === range.to.getTime()
      ? cached
      : null
    if (import.meta.env.DEV && cached && !reusable) {
      console.error(`agendaChunkCache: chunk ${index} held a stale window (week-start changed?) — recomputing instead of reusing it`)
    }
    const next = computeExpansionCache(reusable, items, roots, range.from, range.to)
    agendaChunkCache.set(index, next)
    chunks.push(next)
  }

  // Eviction, commit phase — housekeeping, not a value the render depends on,
  // so it belongs after commit like useExpandWithMultiday's own recency touch.
  // Drops every cached chunk outside the requested range; see the eviction
  // policy note above.
  useEffect(() => {
    const requested = new Set(indices)
    for (const key of agendaChunkCache.keys()) {
      if (!requested.has(key)) agendaChunkCache.delete(key)
    }
  })

  const memo = concatSlot.get(CONCAT_KEY)
  if (memo && sameIndices(memo.indices, indices) && sameChunks(memo.chunks, chunks)) {
    return memo.allOccs
  }

  // Chunks are disjoint, ascending, and each already sorted by dedupeAndSort
  // (model/expansion.ts), so this concatenation is globally sorted with no
  // extra pass needed. Kept in ascending order regardless of that
  // belt-and-braces fact — PR 3's chunk-local sectioning relies on it.
  const allOccs = chunks.flatMap(c => c.allOccs)
  concatSlot.set(CONCAT_KEY, { indices, chunks, allOccs })
  return allOccs
}
