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
 * Returns the fileSlug whose title matches ref, or undefined.
 * File identity (title) lives in the roots map, not on StoreItems.
 */
export function resolveWikilink(ref: string, roots: Roots): string | undefined {
  const lower = ref.toLowerCase()
  for (const [fileSlug, meta] of roots) {
    if (meta.title.toLowerCase() === lower) return fileSlug
  }
  return undefined
}
