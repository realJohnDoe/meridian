import { useCallback, useMemo } from 'react'
import { useStore, NO_PARTICIPANT } from '@/store'
import { occKind } from '@/occView'
import type { Occurrence } from '@/types'

export { NO_PARTICIPANT }

/**
 * The "who" axis, per vault.
 *
 * `hidden` is keyed by vault id because two vaults can each have a "Bob" who is
 * a different person — hiding one must leave the other checked. An occurrence
 * survives when *any* of its participants is still visible in its own vault;
 * one with no participants at all is governed by that vault's `NO_PARTICIPANT`
 * row.
 *
 * State is "hidden", not "shown", so an attendee who appears for the first time
 * (a new invitee on a synced calendar, a name typed into a fresh entry) is
 * visible by default rather than silently filtered out.
 */
export function hideParticipants(
  occs: Occurrence[], hidden: Record<string, string[]>,
): Occurrence[] {
  // The common case — nothing hidden anywhere — returns the input by reference,
  // which is what lets `useFilteredOccs` and the agenda's section cache skip
  // work entirely.
  if (Object.keys(hidden).length === 0) return occs
  return occs.filter(o => {
    const hiddenHere = hidden[o.metadata.vaultId]
    if (!hiddenHere || hiddenHere.length === 0) return true
    const ps = o.metadata.participants
    if (ps.length === 0) return !hiddenHere.includes(NO_PARTICIPANT)
    return ps.some(p => !hiddenHere.includes(p))
  })
}

/** The "which calendar" axis. Purely a view filter — a hidden vault still syncs. */
export function hideVaults(occs: Occurrence[], hiddenVaultIds: string[]): Occurrence[] {
  if (hiddenVaultIds.length === 0) return occs
  return occs.filter(o => !hiddenVaultIds.includes(o.metadata.vaultId))
}

/**
 * A serializable description of the filter's *state* — equal strings mean two
 * `filterOccs` callbacks filter identically, whatever their identities.
 *
 * This is what `calendar/agendaSections.ts` keys its per-chunk section caches
 * on. Keying on the callback's identity instead made every cached chunk
 * hostage to the `useCallback` below having a dep list that was both complete
 * and referentially stable: miss a dep and the cache serves stale rows, add an
 * unstable one and it thrashes on every render. A descriptor built from the
 * same three values removes the class — it can only ever be *too* specific,
 * which costs a rebuild, never a wrong one.
 *
 * Order-independent (both the vault list and each vault's hidden names are
 * sorted) so a store update that rebuilds the same state in a different order
 * doesn't read as a change.
 */
export function describeFilter(
  hiddenVaultIds: string[], hiddenParticipants: Record<string, string[]>, showTasks: boolean,
): string {
  const people = Object.keys(hiddenParticipants).sort()
    .map(vaultId => [vaultId, [...(hiddenParticipants[vaultId] ?? [])].sort()])
  return JSON.stringify([[...hiddenVaultIds].sort(), people, showTasks])
}

/**
 * The single choke point all five view call sites funnel through, so the vault
 * leg composes here ahead of the existing two:
 *
 *     filterOccs = hideVaults ∘ hideTasks ∘ hideParticipants
 *
 * ⚠️ `filterOccs`'s `useCallback` deps must stay complete: `filterKey` beside
 * it is built from the same three values, and the agenda's section caches key
 * on that string rather than on this callback's identity — so a piece of
 * filter state left out of *both* would be invisible to the cache, not merely
 * to the memo. (`overduePool.ts` still keys on the callback by reference; its
 * pass runs over a filtered item set, so a thrash there costs one cheap
 * re-expansion rather than the agenda's rows.)
 */
export function useCalendarFilter() {
  const hiddenVaultIds     = useStore(s => s.hiddenVaultIds)
  const hiddenParticipants = useStore(s => s.hiddenParticipants)
  const showTasks          = useStore(s => s.showTasks)

  const filterOccs = useCallback((occs: Occurrence[]) => {
    const byVault = hideVaults(occs, hiddenVaultIds)
    const byKind  = showTasks ? byVault : byVault.filter(o => occKind(o) !== 'task')
    return hideParticipants(byKind, hiddenParticipants)
  }, [hiddenVaultIds, hiddenParticipants, showTasks])

  const filterKey = useMemo(
    () => describeFilter(hiddenVaultIds, hiddenParticipants, showTasks),
    [hiddenVaultIds, hiddenParticipants, showTasks],
  )

  return { hiddenVaultIds, hiddenParticipants, showTasks, filterOccs, filterKey }
}

/**
 * Memoized wrapper around useCalendarFilter's filterOccs. filterOccs only
 * returns its input by reference when showTasks is on and nothing is hidden —
 * with any filter active, it allocates a new array every call, so callers that
 * feed the result into their own useMemo deps (e.g. AgendaView's day grouping)
 * would otherwise recompute on every render whenever a filter is active.
 */
export function useFilteredOccs(occs: Occurrence[]): Occurrence[] {
  const { filterOccs } = useCalendarFilter()
  return useMemo(() => filterOccs(occs), [occs, filterOccs])
}

/**
 * Vault + participant filtering for the undated list views (Backlog, Notes).
 *
 * Deliberately does *not* apply showTasks: that toggle composes the calendar,
 * and these views have already answered the kind question by existing —
 * Backlog is tasks-only, Notes is notes-only. Honouring showTasks here would
 * blank the entire Backlog whenever tasks are hidden on the calendar. The vault
 * and people legs do apply: hiding a calendar means hiding it everywhere.
 */
export function useParticipantFilteredOccs(occs: Occurrence[]): Occurrence[] {
  const hiddenVaultIds     = useStore(s => s.hiddenVaultIds)
  const hiddenParticipants = useStore(s => s.hiddenParticipants)
  return useMemo(
    () => hideParticipants(hideVaults(occs, hiddenVaultIds), hiddenParticipants),
    [occs, hiddenVaultIds, hiddenParticipants],
  )
}
