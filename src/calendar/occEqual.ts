import type { Occurrence } from '@/types'

function arrayEq(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

/**
 * Field-by-field equality over every Occurrence field that affects what
 * DaySection/OverdueSection actually render (both via OccurrenceRow ->
 * OccurrenceCard, which shows tags/participants/duration by default — see
 * OccurrenceCard's showTagsParticipants). Upstream grouping rebuilds `items`
 * into a fresh array on every unrelated occurrence change, so this is what
 * lets those sections' memo comparators skip re-rendering when their own
 * occurrences are unchanged field-for-field, not just reference-equal.
 *
 * A single shared field list here (rather than one hand-maintained per
 * comparator) means a new Occurrence field that affects rendering only needs
 * adding once.
 */
function occEqual(a: Occurrence, b: Occurrence): boolean {
  if (a === b) return true
  return a.id === b.id
      && a.ownerId === b.ownerId
      && a.fileSlug === b.fileSlug
      && a.date === b.date
      && a.time === b.time
      && (a.metadata.jsTime?.getTime() ?? null) === (b.metadata.jsTime?.getTime() ?? null)
      && a.metadata.done === b.metadata.done
      && a.metadata.title === b.metadata.title
      && a.metadata.priority === b.metadata.priority
      && a.metadata.duration === b.metadata.duration
      && arrayEq(a.metadata.tags, b.metadata.tags)
      && arrayEq(a.metadata.items, b.metadata.items)
      && arrayEq(a.metadata.participants, b.metadata.participants)
}

/** Same-length, per-index occEqual — the shape both sections' `items` arrays need compared as. */
export function occArraysEqual(a: Occurrence[], b: Occurrence[]): boolean {
  if (a.length !== b.length) return false
  return a.every((o, i) => occEqual(o, b[i]))
}
