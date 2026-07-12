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

function matchToRef(m: RegExpExecArray): WikilinkRef {
  return {
    ref:   m[1].trim(),
    label: m[2]?.trim(),
    start: m.index,
    end:   m.index + m[0].length,
  }
}

/**
 * Parse a raw string that is exactly one complete wikilink (the entire string).
 * Returns the WikilinkRef if it matches, or null otherwise.
 */
export function parseSingleWikilink(raw: string): WikilinkRef | null {
  const trimmed = raw.trim()
  WIKILINK_RE.lastIndex = 0
  const m = WIKILINK_RE.exec(trimmed)
  if (m && m.index === 0 && m[0].length === trimmed.length) return matchToRef(m)
  return null
}

export function parseWikilinks(text: string): WikilinkRef[] {
  const results: WikilinkRef[] = []
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    results.push(matchToRef(m))
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

/**
 * Build an O(1) reverse lookup for `resolveWikilink`: lowercased fileSlug|title → fileSlug.
 * Encodes the same resolution order — fileSlug wins over title, case-insensitive, first
 * title wins on duplicate titles — so `buildResolveIndex(roots).get(ref.toLowerCase())`
 * equals `resolveWikilink(ref, roots)`. Callers that resolve many refs against one `roots`
 * build this once instead of paying `resolveWikilink`'s two linear scans per ref.
 */
export function buildResolveIndex(roots: Roots): Map<string, string> {
  const index = new Map<string, string>()
  // Titles first (first-in-iteration wins), then fileSlugs overwrite so a fileSlug match
  // always beats a title alias — matching resolveWikilink's fileSlug-before-title order.
  for (const [fileSlug, meta] of roots) {
    const key = meta.title.toLowerCase()
    if (!index.has(key)) index.set(key, fileSlug)
  }
  for (const [fileSlug] of roots) {
    index.set(fileSlug.toLowerCase(), fileSlug)
  }
  return index
}

/** Strip `[[` / `]]` brackets from a stored wikilink string, returning the raw ref. */
export function unwrapRef(stored: string): string {
  const m = stored.match(/^\[\[(.+)\]\]$/)
  return m ? m[1] : stored
}
