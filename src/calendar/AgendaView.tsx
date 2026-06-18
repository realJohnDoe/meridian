import { useMemo, useCallback, useRef } from 'react'
import { useStore } from '../store'
import type { Occurrence, EditScope, StoreItem, StoreOcc, Roots } from '../types'
import { occKind, isSeries } from '../types'

import { expandWithMultiday } from '../model/expansion'
import { fmtISO } from '../model/dateUtils'
import { sameDay, addDays, sortOccs } from '../presentation'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import DaySection from './DaySection'
import OverdueSection from './OverdueSection'
import { useToday } from '../hooks/useToday'

const isOverdue = (o: Occurrence) => occKind(o) === 'task' && !o.metadata.done

/**
 * Returns true when `a` and `b` have the same scheduling structure, i.e. only
 * non-structural metadata (done, priority, participants) changed between them.
 * When true the caller can skip re-running expandWithMultiday and instead
 * overlay the new metadata values directly onto the cached expansion result.
 *
 * Fields that ARE structural (trigger re-expansion when they change):
 *   - id, fileSlug, date, time (occurrence identity / position)
 *   - repeat rule (series generation rule)
 *   - excluded (occurrence suppression)
 *   - ownerId (override → series relationship)
 *   - duration (multiday span)
 *   - done on after_completion series/overrides (determines the next occurrence)
 */
function hasSameStructure(a: StoreItem[], b: StoreItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false

  // Pre-collect repeat types so we can check after_completion overrides below.
  const seriesTypeById = new Map<string, string | undefined>()
  for (const item of b) {
    if (isSeries(item)) seriesTypeById.set(item.id, item.repeat?.type)
  }

  for (let i = 0; i < a.length; i++) {
    const ai = a[i], bi = b[i]
    if (ai === bi) continue  // same reference → nothing changed

    // Fields present on both RepeatPattern and OccurrenceEntry
    if (ai.id !== bi.id || ai.fileSlug !== bi.fileSlug) return false
    if (ai.date !== bi.date || (ai.time ?? null) !== (bi.time ?? null)) return false

    if (isSeries(ai) && isSeries(bi)) {
      if (JSON.stringify(ai.repeat) !== JSON.stringify(bi.repeat)) return false
      // For after_completion series, done determines when the next occurrence is.
      if (ai.repeat?.type === 'after_completion' && ai.metadata.done !== bi.metadata.done) return false
      if ((ai.metadata.duration ?? '') !== (bi.metadata.duration ?? '')) return false
    } else if (!isSeries(ai) && !isSeries(bi)) {
      const oa = ai as StoreOcc, ob = bi as StoreOcc
      if (oa.excluded !== ob.excluded) return false
      if (oa.ownerId !== ob.ownerId) return false
      if ((oa.metadata.duration ?? '') !== (ob.metadata.duration ?? '')) return false
      // For after_completion overrides, done determines the next occurrence too.
      if (oa.ownerId && seriesTypeById.get(oa.ownerId) === 'after_completion') {
        if (oa.metadata.done !== ob.metadata.done) return false
      }
    } else {
      return false  // one became a series, the other an occurrence
    }
  }
  return true
}

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

export default function AgendaView({ onOpen }: Props) {
  const today = useToday()
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  // Cache the last expandWithMultiday result so we can skip re-expansion when
  // only non-structural metadata (done, priority, participants) changed.
  const expansionCache = useRef<{
    items: StoreItem[]
    roots: Roots
    today: Date
    allOccs: Occurrence[]
  } | null>(null)

  // Expand occurrences and group them by day — same window as buildAgenda().
  const groups = useMemo(() => {
    const from = addDays(today, -7)
    const to = addDays(today, 90)

    let allOccs: Occurrence[]
    const cache = expansionCache.current

    if (cache && cache.today === today && cache.roots === roots && hasSameStructure(cache.items, items)) {
      // Only non-structural metadata changed (e.g. done toggle, priority).
      // Find items whose reference changed and overlay their new metadata.
      const changedById = new Map<string, StoreOcc>()
      for (let i = 0; i < items.length; i++) {
        if (items[i] !== cache.items[i] && !isSeries(items[i])) {
          changedById.set(items[i].id, items[i] as StoreOcc)
        }
      }
      allOccs = changedById.size === 0
        ? cache.allOccs
        : cache.allOccs.map(occ => {
            const changed = changedById.get(occ.id)
            if (!changed) return occ
            return {
              ...occ,
              metadata: {
                ...occ.metadata,
                done:         changed.metadata.done,
                priority:     changed.metadata.priority,
                participants: changed.metadata.participants,
              },
            }
          })
    } else {
      allOccs = expandWithMultiday(items, roots, from, to)
    }

    expansionCache.current = { items, roots, today, allOccs }

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
  }, [items, roots, today])

  // Stable references so DaySection's memo comparator isn't short-circuited
  // by new function identities on every AgendaView render.
  const handleToggleDone = useCallback((occ: Occurrence) => toggleOccDone(occ), [])
  const handleSwipeDelete = useCallback((occ: Occurrence) => beginSwipeDelete(occ), [])

  const todayKey = fmtISO(today)
  const sortedKeys = Object.keys(groups).sort()
  const pastKeys = sortedKeys.filter(k => k < todayKey)
  const currentKeys = sortedKeys.filter(k => k >= todayKey)
  const overdueItems = sortOccs(pastKeys.flatMap(k => groups[k].items.filter(isOverdue)))

  return (
    <div className="pb-24 lg:max-w-[720px] lg:mx-auto">
      {/* Past day sections — overdue tasks excluded; skip sections that become empty */}
      {pastKeys.map(k => {
        const items = sortOccs(groups[k].items.filter(o => !isOverdue(o)))
        if (!items.length) return null
        return (
          <DaySection
            key={k}
            dateKey={k}
            date={groups[k].date}
            isToday={false}
            isTomorrow={false}
            items={items}
            onOpen={onOpen}
            onToggleDone={handleToggleDone}
            onSwipeDelete={handleSwipeDelete}
          />
        )
      })}

      {/* Overdue — only rendered when non-empty */}
      {overdueItems.length > 0 && (
        <OverdueSection
          items={overdueItems}
          onOpen={onOpen}
          onToggleDone={handleToggleDone}
          onSwipeDelete={handleSwipeDelete}
        />
      )}

      {/* Today + future */}
      {currentKeys.map(k => {
        const g = groups[k]
        const isToday = sameDay(g.date, today)
        const isTomorrow = sameDay(g.date, addDays(today, 1))
        return (
          <DaySection
            key={k}
            dateKey={k}
            date={g.date}
            isToday={isToday}
            isTomorrow={isTomorrow}
            items={sortOccs(g.items)}
            onOpen={onOpen}
            onToggleDone={handleToggleDone}
            onSwipeDelete={handleSwipeDelete}
          />
        )
      })}
    </div>
  )
}
