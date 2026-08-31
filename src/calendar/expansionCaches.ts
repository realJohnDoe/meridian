import type { ExpansionCache } from '@/model'
import type { AgendaSectionCache } from './agendaSections'
import type { OverduePoolCache } from './overduePool'

/**
 * The single owner of every render-phase-written module-level cache in
 * calendar/ — four singletons (Month/Day/Week's shared window cache, the
 * agenda's own chunk cache, its grouped/sorted sections, and its overdue
 * pool), each previously reset by hand from its own file. Miss one on vault
 * change and the agenda (or a pane) shows another vault's rows —
 * `AgendaView.test.tsx`'s `beforeEach(resetCalendarOnVaultChange)` carries a
 * comment about tests contaminating each other without it. `resetAll` is
 * wired once into `viewState.ts`'s `resetCalendarOnVaultChange` so a new
 * cache added here never needs a second wiring site.
 */

// MonthGrid keeps three panes (prev/current/next month) alive at once, and
// DayPane/WeekPane's carousels do the same for days/weeks (5 panes each), so
// several distinct (from, to) windows are live simultaneously — keying by
// window lets every caller share one cache without evicting each other's
// entries every render. Capped so months/days/weeks scrolled past and
// forgotten don't accumulate forever. See useExpandWithMultiday.ts.
export const MAX_CACHED_WINDOWS = 16
export const cacheByWindow = new Map<string, ExpansionCache>()

/**
 * The agenda's own expansion cache, keyed by absolute chunk index
 * (agendaChunks.ts) rather than by window. Deliberately not sharing
 * `cacheByWindow` above: `MAX_CACHED_WINDOWS` is sized for Month/Day/Week's
 * panes, and chunked scrolling would evict live chunks well before that cap —
 * the two eviction policies genuinely differ (LRU there, range retention
 * here). See useAgendaChunks.ts.
 */
export const agendaChunkCache = new Map<number, ExpansionCache>()

// The agenda is a singleton view (only one instance mounted at a time), so a
// single cache slot each — unlike cacheByWindow above, which has to serve
// several concurrent callers — is enough here. See useAgendaSections.ts.
export const SECTIONS_CACHE_KEY = 'agenda'
export const sectionsCacheSlot = new Map<typeof SECTIONS_CACHE_KEY, AgendaSectionCache>()
export const overduePoolSlot = new Map<typeof SECTIONS_CACHE_KEY, OverduePoolCache>()

/**
 * Drops every cache above. Call on vault change — see
 * `resetCalendarOnVaultChange` in viewState.ts, the sole call site.
 */
export function resetAll(): void {
  cacheByWindow.clear()
  agendaChunkCache.clear()
  sectionsCacheSlot.clear()
  overduePoolSlot.clear()
}
