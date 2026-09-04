/**
 * The retention sweep's predicate — plans/archived-entries.md PR 4a. Pure
 * over one entry's `StoreItem[]`; `storage/retentionSweep.ts` pairs this with
 * the file's age (4b/4d) before archiving anything.
 *
 * A file is a candidate when every item is finished — see the plan's table
 * for the full case list. Two traps it calls out, guarded against here:
 * "never ends" is the *absence* of `RepeatEnd` (not a `'never'` value — that
 * vocabulary belongs to the repeat dialog's form state in `repeat.ts`, not
 * the persisted shape), and `isTracked` is presence-based, so a task with
 * `done: false` is still open — never simplified to `!!done`.
 */
import { startOfDay } from 'date-fns'
import { isSeries, isStandaloneOcc } from '@/types'
import type { StoreItem, StoreOcc, StoreSeries, Roots } from '@/types'
import { parseDateString } from './dateUtils'
import { expandRange } from './expansion'
import { hasOpenAfterCompletionOccurrence } from './storeOps'

/** No file-level field this predicate reads (only per-occurrence `done`/
 *  `date`) comes from the root, so an empty `Roots` is enough to drive
 *  `expandRange` — it only needs one for `AppMetadata`'s shape. */
const NO_ROOTS: Roots = new Map()

/**
 * How far past `today` a bounded `schedule` series is walked to find its
 * last occurrence. Generous rather than exact: the walk stops at the rule's
 * own `end` regardless (`iterScheduledDates`'s `walkBound` is the earlier of
 * the query window and the resolved `until`/`count` bound), so this only has
 * to outrun any real-world bound, never compute one itself.
 */
const FAR_FUTURE_YEARS = 200

/** One occurrence slot: done (tracked) or past its date (untracked, i.e. an event). */
function isFinishedSlot(done: boolean | undefined, dateStr: string, today: Date): boolean {
  if (done !== undefined) return done === true
  if (!dateStr) return false // undated untracked — a note, deliberately left for later
  const d = parseDateString(dateStr)
  return d !== null && d < startOfDay(today)
}

/** A bounded `schedule` series: finished once every occurrence it will ever
 *  produce is done (tracked) or past (event). Unbounded (`repeat.end`
 *  absent) is never finished — see the module doc's first trap. */
function isScheduledSeriesFinished(series: StoreSeries, items: StoreItem[], today: Date): boolean {
  if (series.repeat.type !== 'schedule' || !series.repeat.end) return false
  const children = items.filter(i => !isSeries(i) && i.ownerId === series.id)
  const from = parseDateString(series.date) ?? startOfDay(today)
  const to = new Date(today.getFullYear() + FAR_FUTURE_YEARS, today.getMonth(), today.getDate())
  const occs = expandRange([series, ...children], NO_ROOTS, from, to)
  return occs.length > 0 && occs.every(o => isFinishedSlot(o.metadata.done, o.date, today))
}

/**
 * An `after_completion` series: finished only once cancellation, not
 * completion, was the last thing to happen to it.
 *
 * `hasOpenAfterCompletionOccurrence` alone is not enough here — it is `false`
 * both when the frontier occurrence was cancelled AND when it was completed
 * (a `done` item is not "open" either), and those two must not read the same
 * way: completing an occurrence *generates the next one*
 * (`src/model/expansion.ts:108`), so a just-completed series still has work
 * coming, virtually, with no `StoreItem` of its own yet. Cancelling is the
 * one action with no successor. So once no item is open, the tie is broken
 * by asking what the most recently dated child actually was: excluded means
 * the chain is over; done (or no children at all, i.e. a pristine series
 * that was never even started) means it is not.
 */
function isAfterCompletionFinished(series: StoreSeries, items: StoreItem[]): boolean {
  if (hasOpenAfterCompletionOccurrence(items, series.id)) return false
  const children = items.filter((i): i is StoreOcc => !isSeries(i) && i.ownerId === series.id)
  if (children.length === 0) return false
  const latest = children.reduce((a, b) => (b.date > a.date ? b : a))
  return !!latest.excluded
}

function isItemFinished(item: StoreItem, items: StoreItem[], today: Date): boolean {
  if (isSeries(item)) {
    // after_completion is bounded by its own instances rather than an
    // open-ended rule (expansion.ts), so its occurrences are already
    // materialised in `items` — no date walk needed, unlike `schedule`.
    return item.repeat.type === 'after_completion'
      ? isAfterCompletionFinished(item, items)
      : isScheduledSeriesFinished(item, items, today)
  }
  return isFinishedSlot(item.metadata.done, item.date, today)
}

/**
 * True when every item in `items` — one entry's full `StoreItem[]` — is
 * finished. Only series roots and standalone occurrences are evaluated
 * directly; a series' override children are folded into its own check
 * (`isScheduledSeriesFinished`'s expansion, `hasOpenAfterCompletionOccurrence`'s
 * scan) rather than judged as independent items.
 */
export function isEntryFinished(items: StoreItem[], today: Date): boolean {
  return items
    .filter(i => isSeries(i) || isStandaloneOcc(i))
    .every(item => isItemFinished(item, items, today))
}
