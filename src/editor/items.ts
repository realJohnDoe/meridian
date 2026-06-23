/**
 * Helpers for parsing and serializing entries in the `items` frontmatter field.
 *
 * Each raw string in `items` is one of:
 *   - A wikilink: `[[fileSlug]]` — a link to another item.
 *   - A task:     `[ ] text` / `[x] text` — a plain checkbox item.
 *
 * Strings that don't match either pattern are treated as unchecked tasks.
 */

const WIKILINK_ITEM_RE = /^\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]$/

/** Matches `[ ] text` / `[x] text` — group 1 is the done char, group 2 is the content. */
export const TASK_ITEM_RE = /^\[([ xX])\]\s+(.+)$/

export type ItemEntry =
  | { kind: 'link'; ref: string; raw: string }
  | { kind: 'task'; text: string; done: boolean; raw: string }

export function parseItemEntry(raw: string): ItemEntry {
  const trimmed = raw.trim()
  const wl = WIKILINK_ITEM_RE.exec(trimmed)
  if (wl) return { kind: 'link', ref: wl[1].trim(), raw }
  const task = TASK_ITEM_RE.exec(trimmed)
  if (task) return { kind: 'task', text: task[2].trim(), done: task[1] !== ' ', raw }
  return { kind: 'task', text: trimmed, done: false, raw }
}

export function serializeTaskEntry(text: string, done: boolean): string {
  return `${done ? '[x]' : '[ ]'} ${text}`
}
