import type { Roots } from './types'

export interface WikilinkRef {
  ref: string
  label?: string
  /** Start index of `[[` in the source string */
  start: number
  /** End index (exclusive) of `]]` in the source string */
  end: number
}

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g

export function parseWikilinks(text: string): WikilinkRef[] {
  const results: WikilinkRef[] = []
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    results.push({
      ref:   m[1].trim(),
      label: m[2]?.trim(),
      start: m.index,
      end:   m.index + m[0].length,
    })
  }
  return results
}

/**
 * Resolve a wikilink ref against the roots map.
 * Returns the fileSlug, or undefined if not found.
 *
 * Resolution order (Obsidian-compatible):
 *  1. Exact fileSlug match — `[[project-alpha]]` → the slug we store in topics
 *  2. Title alias match    — `[[Project Alpha]]` → convenience for hand-typed links
 */
export function resolveWikilink(ref: string, roots: Roots): string | undefined {
  const lower = ref.toLowerCase()
  // 1. FileSlug match (primary — what we store in topics: ["[[fileSlug]]"])
  for (const [fileSlug] of roots) {
    if (fileSlug.toLowerCase() === lower) return fileSlug
  }
  // 2. Title alias
  for (const [fileSlug, meta] of roots) {
    if (meta.title.toLowerCase() === lower) return fileSlug
  }
  return undefined
}

/** Strip `[[` / `]]` brackets from a stored wikilink string, returning the raw ref. */
export function unwrapRef(stored: string): string {
  const m = stored.match(/^\[\[(.+)\]\]$/)
  return m ? m[1] : stored
}
