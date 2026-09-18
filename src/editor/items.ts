/**
 * Helpers for parsing and serializing entries in the `items` frontmatter field.
 *
 * Each raw string in `items` is one of:
 *   - A wikilink: `[[fileSlug]]` — a link to another item.
 *   - A task:     `[ ] text` / `[x] text` — a plain checkbox item.
 *
 * Strings that don't match either pattern are treated as unchecked tasks.
 */

import { parseSingleWikilink } from '../wikilinks'

/** Matches `[ ] text` / `[x] text` — group 1 is the done char, group 2 is the content. */
export const TASK_ITEM_RE = /^\[([ xX])\]\s+(.+)$/

export type ItemEntry =
  | { kind: 'link'; ref: string; raw: string }
  | { kind: 'task'; text: string; done: boolean; raw: string }

export function parseItemEntry(raw: string): ItemEntry {
  const trimmed = raw.trim()
  const wl = parseSingleWikilink(trimmed)
  if (wl) return { kind: 'link', ref: wl.ref, raw }
  const task = TASK_ITEM_RE.exec(trimmed)
  if (task) return { kind: 'task', text: task[2]!.trim(), done: task[1] !== ' ', raw }
  return { kind: 'task', text: trimmed, done: false, raw }
}

export function serializeTaskEntry(text: string, done: boolean): string {
  return `${done ? '[x]' : '[ ]'} ${text}`
}

/**
 * A stable identity per entry, in `items` order.
 *
 * The array index cannot serve as one: removing an item re-indexes every later
 * item, so index-keyed rows trade identities behind the animation layer, which
 * then glides each surviving row from wherever its *neighbour* used to be — the
 * list appears to shuffle on a removal that moved nothing. The content is
 * stable under the one field the user changes in place (a task's done state
 * lives outside the key; a link's target file owns its own), with a counter
 * appended so the duplicates a hand-edited file may hold stay distinct.
 */
export function itemKeys(entries: readonly ItemEntry[]): string[] {
  const seen = new Map<string, number>()
  return entries.map(e => {
    const base = e.kind === 'link' ? `link:${e.ref}` : `task:${e.text}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}#${n}`
  })
}
