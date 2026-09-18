/**
 * What the user changed, and what the store held when they changed it.
 *
 * ## Why this replaces a second snapshot
 *
 * The editor used to hold two complete `EntryState`s — the one on screen and
 * `baseRef`, "what this editor last knew the store to agree with" — and infer
 * the user's intent by diffing them. The inference is only sound while every
 * code path that moves the form for a reason that is *not* a user edit also
 * moves the base, and nothing said so: not the types, not a lint rule, not a
 * test. Three shipped bugs came out of that gap, in both directions — a scope
 * switch that moved the form and not the base (so a save saw three values for
 * one field and reported a conflict with nobody), and an 'add'-scope view that
 * blanked `done` in the form and had nowhere to read the real value back from
 * (so an unrelated later edit un-ticked a completed task).
 *
 * Recording the edits instead removes the inference. A field the user has not
 * touched is simply absent here, so it is read live from the store and there
 * is no stale copy of it anywhere to forget to refresh. A scope switch changes
 * which store values the view is derived *from*; it cannot desynchronise
 * anything, because there is no second copy to desynchronise.
 *
 * ## `storeWas`
 *
 * One fact per touched field: the store's value at the moment the user first
 * touched it. A *fact*, recorded once at a known instant, not a belief that
 * has to be maintained — which is the whole difference from `baseRef`, and the
 * same shape the sync layer's base has (the content as last pushed).
 *
 * It is what makes an honest conflict report possible: a field is contested
 * when the store has moved off `storeWas` since, to something that is not what
 * the user typed. With a single writer that cannot happen, which is the
 * property `singleWriter.test.tsx` checks.
 */
import { sameValue } from '@/model'
import type { EditFields } from '@/model'
import type { EntryState } from './state'

/** The store-owned fields an editor save carries — `EntryState` minus its view-only parts. */
export function editFieldsOf(entry: EntryState): EditFields {
  return {
    title:        entry.title,
    tags:         entry.tags,
    items:        entry.items,
    participants: entry.participants,
    body:         entry.body,
    tracked:      entry.tracked,
    done:         entry.done,
    priority:     entry.priority  ?? null,
    scheduled:    entry.scheduled ?? null,
    duration:     entry.duration,
    repeat:       entry.repeat    ?? null,
  }
}

/**
 * Every `EditFields` key, listed rather than derived from a value so a field
 * added to the type is a compile error here until someone decides whether the
 * editor owns it — same reasoning as `merge.ts`'s `EDIT_FIELD_KEYS`, which
 * this deliberately mirrors.
 */
const EDIT_KEYS = [
  'title', 'body', 'tags', 'items', 'participants',
  'tracked', 'done', 'priority', 'scheduled', 'duration', 'repeat',
] as const satisfies ReadonlyArray<keyof EditFields>

/** One touched field: what the user set it to, and what the store held first. */
interface Edit {
  value:    EditFields[keyof EditFields]
  storeWas: EditFields[keyof EditFields]
}

/**
 * A key present with `undefined` means the same as a key absent: not edited.
 * Spelt that way rather than deleted so the set is only ever built by
 * assignment — `no-dynamic-delete` is a lint rule here, and a `delete` over a
 * computed key is how a `Partial` record grows holes nobody accounts for.
 */
export type Edits = Partial<Record<keyof EditFields, Edit | undefined>>

/** Whether anything is actually edited — see `Edits` on why a key can be a hole. */
export function hasEdits(edits: Edits): boolean {
  return Object.values(edits).some(Boolean)
}

/**
 * Fold a proposed `EntryState` into the edit set.
 *
 * `from` is what the form currently shows (view ⊕ edits) and `to` is what the
 * caller wants it to show, so their difference is exactly what the user just
 * did — no more, whatever else moved underneath. `view` supplies `storeWas`
 * for a field entering the set for the first time; a field already in it keeps
 * the value it was first recorded against.
 *
 * An edit that lands back on `storeWas` leaves the set rather than staying as
 * a no-op write. That keeps `touchedKeys` honest for `applyEdit`'s `extra`-bag
 * strip, which deletes a hand-authored raw value for every field it is told
 * the save is rewriting (data-integrity survey, finding #1).
 */
export function foldEdits(prev: Edits, from: EntryState, to: EntryState, view: EntryState): Edits {
  const fromFields = editFieldsOf(from)
  const toFields   = editFieldsOf(to)
  const viewFields = editFieldsOf(view)
  let next: Edits | null = null
  for (const key of EDIT_KEYS) {
    if (sameValue(fromFields[key], toFields[key])) continue
    next ??= { ...prev }
    // `prev[key]`, not `key in prev`: a key can be present as a hole (see
    // `Edits`), and a hole means not edited, so its baseline is the view's.
    const existing = prev[key]
    const storeWas = existing ? existing.storeWas : viewFields[key]
    // Back where it started: not an edit any more, so out of the set entirely.
    next[key] = sameValue(toFields[key], storeWas) ? undefined : { value: toFields[key], storeWas }
  }
  return next ?? prev
}

/**
 * The fields whose meaning depends on the edit scope — the three `applyScope`
 * re-derives. `scheduled` and `repeat` name this occurrence at 'single' and
 * the series at 'all'/'future'; `done` is blanked for 'add', which is about to
 * create a different occurrence entirely.
 */
const SCOPED_FIELDS = ['scheduled', 'repeat', 'done'] as const satisfies ReadonlyArray<keyof EditFields>

/**
 * Drop the scope-dependent edits, for a scope change.
 *
 * A pending edit to one of these does not survive the question changing
 * underneath it: "3 days" typed while the scope said "add new occurrence" is
 * not a proposal about the series' repeat, and its `storeWas` — the store's
 * answer at the *old* scope — is not a baseline for anything at the new one.
 * Carrying either across is how a scope switch turns into a phantom second
 * writer. The old form-and-base pair did the same thing by overwriting these
 * three on every scope change; here it is one place and says why.
 *
 * Everything else is scope-independent (a title is the file's title at every
 * scope) and rides through untouched.
 */
export function dropScopedEdits(edits: Edits): Edits {
  if (!SCOPED_FIELDS.some(key => edits[key])) return edits
  const next = { ...edits }
  for (const key of SCOPED_FIELDS) next[key] = undefined
  return next
}

/** The form: the store's view with the user's edits laid over it. */
export function applyEdits(view: EntryState, edits: Edits): EntryState {
  if (!hasEdits(edits)) return view
  const out = { ...view }
  for (const key of EDIT_KEYS) {
    const edit = edits[key]
    // The cast is the narrowing TypeScript can't do over a union of keys —
    // each key's value type is preserved across the assignment, same as
    // `mergeEditFields`.
    if (edit) (out as Record<string, unknown>)[key] = edit.value
  }
  return out
}

/** The touched fields alone, for the save path. */
export function editedFields(edits: Edits): Partial<EditFields> {
  const out: Record<string, unknown> = {}
  for (const key of EDIT_KEYS) {
    const edit = edits[key]
    if (edit) out[key] = edit.value
  }
  return out
}

/**
 * The fields where somebody else moved the store out from under an edit in
 * flight — the store is no longer at `storeWas`, and where it has gone is not
 * where the user was taking it.
 *
 * These are the genuine overlaps and the only ones: a field the user has not
 * touched is not in the set at all, and a store that still sits at `storeWas`
 * has no opinion to lose. The write resolves them in the user's favour, so the
 * report exists to say a race happened, not to ask anything.
 */
export function contestedFields(edits: Edits, view: EntryState): Array<keyof EditFields> {
  const viewFields = editFieldsOf(view)
  // `EDIT_KEYS` order rather than the set's insertion order, so a report built
  // from this reads the same way twice — same rule as `overlappingFields`.
  return EDIT_KEYS.filter(key => {
    const edit = edits[key]
    return !!edit
      && !sameValue(edit.storeWas, viewFields[key])
      && !sameValue(edit.value, viewFields[key])
  })
}
