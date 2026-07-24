import { useMemo } from 'react'
import { useStore } from '@/store'
import type { Occurrence } from '@/types'
import { occKind } from '@/occView'
import { fmtISO } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useFilteredOccs } from '@/hooks'

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

/**
 * The agenda's data pipeline: expand occurrences over the agenda window,
 * apply the calendar filter, group by day, then flatten into one ordered
 * list of virtualizable sections (past days → overdue → current/future days).
 *
 * Pulled out of AgendaView so this derivation — pure of the virtualizer, the
 * scroll listener, and the scroll-to-today effect — is something the React
 * Compiler can memoize normally. AgendaView itself carries a `'use no memo'`
 * opt-out because of its useVirtualizer() usage; that opt-out no longer
 * reaches this logic.
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

  // Group occurrences by day.
  const groups = useMemo(() => {
    const result: Record<string, { date: Date; items: Occurrence[] }> = {}

    // Always seed today so goToday() can always find a section to scroll to.
    const todayKey = fmtISO(today)
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
  }, [allOccs, today])

  // Flatten the groups into one ordered list of sections to virtualize:
  // past day-sections (overdue excluded, non-empty) → overdue → current days.
  const sections = useMemo<Section[]>(() => {
    const todayKey = fmtISO(today)
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
  }, [groups, today, now])

  // goToday: scroll to the overdue section (if any) else today. Off-screen
  // sections aren't in the DOM, so we use the virtualizer index rather than a
  // querySelector. The today section is always seeded, so an index exists.
  const goToIndex = useMemo(() => {
    const overdueIdx = sections.findIndex(s => s.kind === 'overdue')
    if (overdueIdx >= 0) return overdueIdx
    return sections.findIndex(s => s.kind === 'day' && s.isToday)
  }, [sections])

  return { sections, goToIndex }
}
