/**
 * Three-way merges — this module's answer to "both sides changed".
 *
 * Two of them, at two layers, doing the same thing to the same domain:
 *
 *  - `mergeFileContent` merges two divergent *files* against the common
 *    ancestor the local edit was made from. Used by `resolveCollision` before
 *    it falls back to writing a conflict copy.
 *  - `mergeEditFields` merges an editor's *proposed fields* against the
 *    snapshot that editor loaded. Used by `saveNode` so a save writes only
 *    what the user actually touched, instead of every field the editor happens
 *    to be holding.
 *
 * They share one rule, which is the whole idea: **a side that did not change a
 * value has no opinion about it.** Take the side that moved; take either when
 * both moved to the same value; refuse only when both moved to different ones.
 * Without an ancestor there is no way to tell "did not change" from "changed to
 * exactly this", which is why both entry points need a base and why
 * `mergeFileContent` returns null rather than guessing when it has none.
 *
 * Deliberately no textual (diff3) merge of the body: two people typing in the
 * same prose at the same time is a real overlap, and inventing an interleaving
 * for it is worse than handing both versions back. Frontmatter is merged
 * key-by-key because its keys *are* independent fields — which is the case
 * this module exists for (one person reschedules a task while another writes
 * its description).
 */

import { loadFile } from '@/fileIO'
import { saveFile } from './inheritance'
import type { EditFields } from './storeOps'

/**
 * Structural equality for parsed-YAML values and editor field values alike:
 * scalars, arrays, and plain objects. Both callers compare values that came
 * out of `yamlParse` or out of the editor's own state, so there is nothing
 * exotic (Date, Map, class instance) to handle — and `undefined` compares
 * equal to `undefined`, which is what makes "absent on both sides" a
 * non-change rather than a conflict.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  const bKeys = Object.keys(bo)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(k => Object.hasOwn(bo, k) && sameValue(ao[k], bo[k]))
}

/**
 * Pick the winning value for one key. `undefined` means "the key is absent on
 * that side", so a deletion merges exactly like any other change.
 * Null = the two sides changed the same key to different values.
 */
function pickValue(base: unknown, local: unknown, remote: unknown): { value: unknown } | null {
  const localMoved  = !sameValue(base, local)
  const remoteMoved = !sameValue(base, remote)
  if (localMoved && remoteMoved) {
    return sameValue(local, remote) ? { value: local } : null
  }
  return { value: localMoved ? local : remote }
}

/**
 * Merge two frontmatter objects key-by-key.
 *
 * Key order follows `base` first, then keys only one side added — so a merge
 * doesn't reshuffle a file the user has never seen reshuffled. (`saveFile`
 * re-orders `defaults`/`instances` on its own regardless; everything between
 * them keeps insertion order.)
 */
function mergeRawNodes(
  base:   Record<string, unknown>,
  local:  Record<string, unknown>,
  remote: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const picked = pickValue(base[key], local[key], remote[key])
    if (!picked) return null
    if (picked.value !== undefined) out[key] = picked.value
  }
  return out
}

/** Merge two bodies whole — see the no-diff3 note at the top of this file. */
function mergeBody(base: string, local: string, remote: string): string | null {
  if (local === remote) return local
  if (local === base)   return remote
  if (remote === base)  return local
  return null
}

/**
 * Merge a local and a remote version of one file against `base` — the content
 * the local edit was made from.
 *
 * Returns the merged file, or null when the two sides genuinely overlap (the
 * same frontmatter key set to two different values, or both bodies edited).
 * Null is not a failure: it is the signal that a conflict copy is the honest
 * outcome, and it is what the caller falls back to.
 *
 * The result is serialised through `saveFile`, exactly as an ordinary save
 * would be, so a merge introduces no formatting the app doesn't already
 * produce. The remote's `FileConvention` is carried over rather than the
 * local's, because the remote is the version that keeps the path.
 */
export function mergeFileContent(
  path:   string,
  base:   string,
  local:  string,
  remote: string,
): string | null {
  if (local === remote) return local
  const b = loadFile(path, base)
  const l = loadFile(path, local)
  const r = loadFile(path, remote)

  const rawNode = mergeRawNodes(b.rawNode, l.rawNode, r.rawNode)
  if (rawNode === null) return null
  const body = mergeBody(b.body, l.body, r.body)
  if (body === null) return null

  return saveFile(rawNode, body, r.convention)
}

/**
 * The fields an editor save is allowed to carry. Listed rather than derived
 * from a value so a field added to `EditFields` is a compile error here until
 * someone decides whether an editor owns it — the alternative (`Object.keys`
 * over one of the arguments) would silently start writing new fields blind,
 * which is the exact behaviour this function exists to remove.
 */
const EDIT_FIELD_KEYS = [
  'title', 'body', 'tags', 'items', 'participants',
  'tracked', 'done', 'priority', 'scheduled', 'duration', 'repeat',
] as const satisfies ReadonlyArray<keyof EditFields>

/**
 * Which of `EDIT_FIELD_KEYS` differ between `base` and `next` — the load-time
 * snapshot versus what the editor is now proposing. The same predicate
 * `mergeEditFields` uses to decide what to write, exposed on its own for a
 * caller that needs to know *which* fields changed, not just their merged
 * values.
 *
 * `storeOps.ts` uses this to scope its `extra`-bag strip to the field a save
 * is actually writing a fresh typed value for, rather than every registry
 * field regardless of whether this edit touched it — see the "Metadata
 * constructors" note there. Untouched fields must keep whatever raw value an
 * earlier malformed write parked in `extra`, or a save the user made to one
 * field silently deletes their hand-authored value for an unrelated one.
 */
export function changedEditFields(base: EditFields, next: EditFields): ReadonlySet<keyof EditFields> {
  const changed = new Set<keyof EditFields>()
  for (const key of EDIT_FIELD_KEYS) {
    if (!sameValue(base[key], next[key])) changed.add(key)
  }
  return changed
}

/**
 * Apply the fields `next` changed relative to `base` onto `current`.
 *
 * `base` is what the editor loaded, `next` is what it is proposing, `current`
 * is what the store holds right now — which is not the same thing as `base`
 * the moment anything else has written to this entry (a sync pulling a change
 * from another device, another tab, a checkbox toggled from the agenda).
 *
 * Without this, every save writes all eleven fields from the editor's own
 * snapshot, so changing one field silently reverts every other field that
 * moved underneath it — and on a synced vault that revert is a push, which the
 * other device then sees as a change to push back. Restricting the write to
 * the fields the user actually touched is what stops two devices undoing each
 * other in a loop.
 */
export function mergeEditFields(base: EditFields, next: EditFields, current: EditFields): EditFields {
  const out = { ...current }
  for (const key of changedEditFields(base, next)) {
    // Each key's value type is preserved across this assignment; the
    // narrowing TypeScript can't do over a union of keys is the only reason
    // this needs a cast at all.
    (out as Record<string, unknown>)[key] = next[key]
  }
  return out
}
