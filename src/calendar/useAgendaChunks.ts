import { useEffect } from 'react'
import type { StoreItem, Roots } from '@/types'
import { computeExpansionCache, type ExpansionCache } from '@/model'
import { chunkRange } from './agendaChunks'
import type { AgendaChunkOccs } from './agendaSections'
import { agendaChunkCache } from './expansionCaches'

interface RunMemo {
  indices: number[]
  chunks: ExpansionCache[]
  run: AgendaChunkOccs[]
}

// Single-slot, same reasoning as useAgendaSections' own cache slots: the
// agenda is a singleton view, so one memoized run is enough.
const RUN_KEY = 'agenda'
const runSlot = new Map<typeof RUN_KEY, RunMemo>()

function sameIndices(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// Compares each chunk's `allOccs` rather than the ExpansionCache object
// itself: computeExpansionCache's own no-op fast path returns a *new* wrapper
// (`{ ...prev, items, roots }`) even when nothing changed, so the wrapper
// reference always differs between renders — only `allOccs` (and the reverse
// indices) are carried over unchanged. Comparing wrappers here would make this
// memo permanently miss.
function sameChunks(a: ExpansionCache[], b: ExpansionCache[]): boolean {
  return a.length === b.length && a.every((v, i) => v.allOccs === b[i]?.allOccs)
}

/**
 * The agenda's own chunked expansion: the loaded run (agendaChunks.ts's
 * `agendaChunkRun`) is a list of fixed, disjoint 28-day chunks, each expanded
 * and cached independently — so widening the run (a jump in from Month/Day
 * view, or a future "load more") reuses every chunk it already holds instead
 * of re-expanding the whole span the way a single `(fromMs, toMs)`-keyed cache
 * would.
 *
 * Deliberately not `useExpandWithMultiday`: that hook's `cacheByWindow` is an
 * LRU sized for Month/Day/Week's several concurrent panes
 * (`MAX_CACHED_WINDOWS`), and chunked scrolling would evict live chunks well
 * before that cap. `agendaChunkCache` (expansionCaches.ts) is this hook's own
 * map instead, with a genuinely different eviction policy. For now that policy
 * is simply "keep every chunk in the requested run, drop the rest" — retention
 * across loads is the incremental-loading PR's problem
 * (plans/agenda-infinite-scroll.md).
 *
 * Every chunk's own `ExpansionCache` already carries the `(fromMs, toMs)` it
 * was built for (model/expansionCache.ts). A lookup that finds an entry whose
 * bounds don't match this chunk index's *current* range — only reachable if
 * the locale week-start changed, since that's the only thing that moves the
 * grid under a fixed index (agendaChunks.ts) — is treated as a miss and
 * recomputed rather than silently reused, and logged loudly in dev: reusing it
 * would resolve to a wrong chunk's occurrences with no other symptom.
 *
 * The result is one occurrence array *per chunk*, not one concatenated array,
 * because sectioning is chunked too (agendaSections.ts): the per-chunk arrays
 * are what let a rebuild stay proportional to the chunks that actually
 * changed. The run itself is memoized on the chunk list's identity rather than
 * rebuilt fresh every render, since `computeAgendaSections` short-circuits
 * entirely when its `chunkOccs` argument is reference-identical to last time.
 */
export function useAgendaChunks(
  items: StoreItem[],
  roots: Roots,
  indices: number[],
  ws: 0 | 1 | 6,
): AgendaChunkOccs[] {
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
  // Drops every cached chunk outside the requested run; see the eviction
  // policy note above.
  useEffect(() => {
    const requested = new Set(indices)
    for (const key of agendaChunkCache.keys()) {
      if (!requested.has(key)) agendaChunkCache.delete(key)
    }
  })

  const memo = runSlot.get(RUN_KEY)
  if (memo && sameIndices(memo.indices, indices) && sameChunks(memo.chunks, chunks)) {
    return memo.run
  }

  // Ascending and disjoint, which is what lets the sectioning stage
  // concatenate one chunk's rows after another's with no merge pass.
  const run = chunks.map((c, i) => ({ index: indices[i]!, occs: c.allOccs }))
  runSlot.set(RUN_KEY, { indices, chunks, run })
  return run
}
