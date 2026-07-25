import { useStore } from '@/store'
import type { Occurrence } from '@/types'
import { occKind } from '@/occView'
import { fmtISO } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useFilteredOccs } from './useCalendarFilter'

const isOverdue = (o: Occurrence) => occKind(o) === 'task' && !o.metadata.done

// Asymmetric on purpose: overdue tasks can be arbitrarily old (see the fix
// that expanded this from 7 to 365 days so old tasks would still surface in
// the overdue section), but the agenda itself is a near-term view — planning
// further ahead than a season ahead belongs in month view, not an infinitely
// scrolling list.
const PAST_WINDOW_DAYS = 365
const FUTURE_WINDOW_DAYS = 90

// Size estimates for the virtualizer. Real sizes are measured after render
// (measureElement); accurate estimates just keep the scrollbar/scrollToIndex
// stable before a section has been measured. initialMeasurementsCache means
// returning users always get real sizes — estimates only matter on first visit.
//
// HEADER_H: DaySection header div — pt-3.5 (14) + pb-1.5 (6) + text-xs line (~20) ≈ 40px
// ROW_H:    OccurrenceCard min-h-11 + py-2 padding + OccurrenceRow mb-1.5 (6) ≈ 68px
// Update these if the header/card padding changes in DaySection.tsx / OccurrenceCard.tsx.
const HEADER_H = 40
const ROW_H = 68

export type Section =
  | { kind: 'day'; key: string; dateKey: string; date: Date; isToday: boolean; isTomorrow: boolean; items: Occurrence[] }
  | { kind: 'overdue'; key: string; items: Occurrence[] }

export function estimateSection(s: Section): number {
  return HEADER_H + s.items.length * ROW_H
}

function buildGroups(allOccs: Occurrence[], today: Date, todayKey: string): Record<string, { date: Date; items: Occurrence[] }> {
  const result: Record<string, { date: Date; items: Occurrence[] }> = {}

  // Always seed today so goToday() can always find a section to scroll to.
  result[todayKey] = {
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    items: [],
  }

  // Add each occurrence to its day group. Multiday events get a "(Day X of N)"
  // suffix so they render like regular occurrence cards on every covered day.
  allOccs.forEach(o => {
    const jsTime = o.metadata.jsTime
    if (!jsTime) return
    const k = fmtISO(jsTime)
    if (!result[k]) {
      result[k] = {
        date: new Date(jsTime.getFullYear(), jsTime.getMonth(), jsTime.getDate()),
        items: [],
      }
    }
    result[k].items.push(o)
  })

  return result
}

// Flattens the groups into one ordered list of sections to virtualize:
// past day-sections (overdue excluded, non-empty) → overdue → current days.
function buildSections(groups: Record<string, { date: Date; items: Occurrence[] }>, today: Date, todayKey: string, now: Date): Section[] {
  const sortedKeys = Object.keys(groups).sort()
  const pastKeys = sortedKeys.filter(k => k < todayKey)
  const currentKeys = sortedKeys.filter(k => k >= todayKey)
  const overdueItems = sortOccs(pastKeys.flatMap(k => groups[k].items.filter(isOverdue)), now)

  const out: Section[] = []
  for (const k of pastKeys) {
    const dayItems = sortOccs(groups[k].items.filter(o => !isOverdue(o)), now)
    if (!dayItems.length) continue
    out.push({ kind: 'day', key: k, dateKey: k, date: groups[k].date, isToday: false, isTomorrow: false, items: dayItems })
  }
  if (overdueItems.length > 0) {
    out.push({ kind: 'overdue', key: '__overdue__', items: overdueItems })
  }
  for (const k of currentKeys) {
    const g = groups[k]
    out.push({
      kind: 'day', key: k, dateKey: k, date: g.date,
      isToday: sameDay(g.date, today),
      isTomorrow: sameDay(g.date, addDays(today, 1)),
      items: sortOccs(g.items, now),
    })
  }
  return out
}

function computeGoToIndex(sections: Section[]): number {
  // goToday: scroll to the overdue section (if any) else today. Off-screen
  // sections aren't in the DOM, so we use the virtualizer index rather than a
  // querySelector. The today section is always seeded, so an index exists.
  const overdueIdx = sections.findIndex(s => s.kind === 'overdue')
  if (overdueIdx >= 0) return overdueIdx
  return sections.findIndex(s => s.kind === 'day' && s.isToday)
}

interface SectionsCache {
  allOccs: Occurrence[]
  todayKey: string
  nowBucket: number
  sections: Section[]
  goToIndex: number
}

// The agenda is a singleton view (only one instance mounted at a time), so a
// single cache slot — unlike useExpandWithMultiday's per-window map, which
// has to serve several concurrent callers (month's three panes, day's
// carousel) — would be enough here. Still stored as a one-entry Map (not a
// reassigned `let`, and not a plain object's `.current` field either): the
// React Compiler's purity check (react-hooks/immutability /
// react-hooks/globals) flags both reassigning a module binding during render
// and writing a property on one, but a method call like Map.set() on a
// const-bound object is the same pattern useExpandWithMultiday's
// cacheByWindow already uses, and passes.
const SECTIONS_CACHE_KEY = 'agenda'
const sectionsCacheSlot = new Map<typeof SECTIONS_CACHE_KEY, SectionsCache>()

/** Drops the cached grouped/sorted sections. Call on vault change (see resetExpansionCache). */
export function resetAgendaSectionsCache(): void {
  sectionsCacheSlot.clear()
}

/**
 * The agenda's data pipeline: expand occurrences over the agenda window,
 * apply the calendar filter, group by day, then flatten into one ordered
 * list of virtualizable sections (past days → overdue → current/future days).
 *
 * The grouped/sorted result is cached at module scope (see `sectionsCacheSlot`
 * above) rather than via useMemo, so that remounting AgendaView — which
 * discards useMemo's cache along with the rest of the component's state —
 * still reuses the prior result when the inputs haven't actually changed.
 *
 * `today` and `now` are passed in rather than read here via useToday/useNow,
 * since AgendaView needs both for its own scroll-to-today and per-row
 * live-repaint logic too — one ticking source shared by both, not two.
 */
export function useAgendaSections(today: Date, now: Date): { sections: Section[]; goToIndex: number } {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const from = addDays(today, -PAST_WINDOW_DAYS)
  const to = addDays(today, FUTURE_WINDOW_DAYS)
  const allOccs = useFilteredOccs(useExpandWithMultiday(items, roots, from, to))

  const todayKey = fmtISO(today)
  // now ticks once a minute (see useNow) and AgendaView remounts allocate a
  // fresh Date even on the same tick, so bucket to that same granularity
  // rather than gating on now's object identity — otherwise every remount
  // would miss the cache even when nothing overdue-relevant has changed.
  const nowBucket = Math.floor(now.getTime() / 60_000)

  const cached = sectionsCacheSlot.get(SECTIONS_CACHE_KEY)
  if (
    cached
    && cached.allOccs === allOccs
    && cached.todayKey === todayKey
    && cached.nowBucket === nowBucket
  ) {
    return { sections: cached.sections, goToIndex: cached.goToIndex }
  }

  const groups = buildGroups(allOccs, today, todayKey)
  const sections = buildSections(groups, today, todayKey, now)
  const goToIndex = computeGoToIndex(sections)

  sectionsCacheSlot.set(SECTIONS_CACHE_KEY, { allOccs, todayKey, nowBucket, sections, goToIndex })
  return { sections, goToIndex }
}
