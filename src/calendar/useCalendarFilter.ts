import { useCallback, useMemo } from 'react'
import { useStore, NO_PARTICIPANT } from '@/store'
import { occKind, isArchived } from '@/occView'
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
 * Archived entries are hidden everywhere an occurrence can show up — see
 * GLOSSARY.md `archived`. Unlike `showTasks`, this is never optional and
 * carries no store-backed toggle: archived-ness is occurrence data, not
 * filter state, so it needs no entry in `describeFilter` either — the
 * agenda's section cache already invalidates on array length, and archiving
 * a file changes it.
 *
 * The common case — nothing archived — returns the input by reference, same
 * rule as `hideVaults`/`hideParticipants` above and for the same reason: with
 * no state to short-circuit on (archived-ness lives on the occurrences
 * themselves, not in a store field this can check up front), the `.some`
 * scan is what keeps `filterOccs`'s "no active filter → same array back" case
 * true even once this leg is unconditionally in the chain — see
 * `useFilteredOccs`'s comment on why that reference stability matters.
 */
function hideArchived(occs: Occurrence[]): Occurrence[] {
  return occs.some(o => isArchived(o.metadata)) ? occs.filter(o => !isArchived(o.metadata)) : occs
}

/**
 * The legs that apply to an occurrence no matter which of the two
 * compositions below it goes through — vaults, archived-ness, and
 * participants. Extracted so an "applies everywhere" leg (like archived) is
 * added in exactly one place, never independently to `filterOccs` and
 * `useParticipantFilteredOccs` — the two used to hand-compose their own
 * subsets of this, which is how a leg could land in one and silently miss the
 * other. `showTasks` stays OUT of this: it is calendar-specific, not a
 * blanket "hide everywhere" axis — see `useParticipantFilteredOccs`'s own
 * comment for why Backlog/Notes must not inherit it.
 */
function hideEverywhere(
  occs: Occurrence[], hiddenVaultIds: string[], hiddenParticipants: Record<string, string[]>,
): Occurrence[] {
  return hideParticipants(hideArchived(hideVaults(occs, hiddenVaultIds)), hiddenParticipants)
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
 *     filterOccs = hideEverywhere ∘ hideTasks
 *
 * (`hideEverywhere` is itself `hideVaults ∘ hideArchived ∘ hideParticipants`.)
 *
 * ⚠️ `filterOccs`'s `useCallback` deps must stay complete: `filterKey` beside
 * it is built from the same three values, and the agenda's section caches key
 * on that string rather than on this callback's identity — so a piece of
 * filter STATE left out of *both* would be invisible to the cache, not merely
 * to the memo. Archived is not filter state (see `hideArchived`'s comment),
 * so it needs no such entry. (`overduePool.ts` still keys on the callback by
 * reference; its pass runs over a filtered item set, so a thrash there costs
 * one cheap re-expansion rather than the agenda's rows.)
 */
export function useCalendarFilter() {
  const hiddenVaultIds     = useStore(s => s.hiddenVaultIds)
  const hiddenParticipants = useStore(s => s.hiddenParticipants)
  const showTasks          = useStore(s => s.showTasks)

  const filterOccs = useCallback((occs: Occurrence[]) => {
    const byKind = showTasks ? occs : occs.filter(o => occKind(o) !== 'task')
    return hideEverywhere(byKind, hiddenVaultIds, hiddenParticipants)
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
 * Vault + participant (+ archived) filtering for the undated list views
 * (Backlog, Notes).
 *
 * Deliberately does *not* apply showTasks: that toggle composes the calendar,
 * and these views have already answered the kind question by existing —
 * Backlog is tasks-only, Notes is notes-only. Honouring showTasks here would
 * blank the entire Backlog whenever tasks are hidden on the calendar. The
 * vault, archived, and people legs do apply: hiding a calendar (or an
 * archived entry) means hiding it everywhere — see `hideEverywhere`, the
 * function this and `filterOccs` both funnel through so that "everywhere"
 * leg can't be added to one and forgotten on the other.
 */
export function useParticipantFilteredOccs(occs: Occurrence[]): Occurrence[] {
  const hiddenVaultIds     = useStore(s => s.hiddenVaultIds)
  const hiddenParticipants = useStore(s => s.hiddenParticipants)
  return useMemo(
    () => hideEverywhere(occs, hiddenVaultIds, hiddenParticipants),
    [occs, hiddenVaultIds, hiddenParticipants],
  )
}
