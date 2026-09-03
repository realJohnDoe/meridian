import type { EntryKey } from './fileIO'
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
    ref:   m[1]!.trim(),  // group 1 is not optional in WIKILINK_RE
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
 * Resolve a wikilink ref against the roots map, **within one vault**.
 *
 * Files store bare `[[slug]]`, so a link means "the entry with this slug in the
 * vault the linking file itself lives in". Passing the linking file's vaultId
 * is therefore mandatory, not a filter: without it the same bare slug in two
 * vaults would resolve to whichever happened to be earlier in iteration order,
 * and a link could silently retarget an unrelated entry.
 *
 * Returns the target's EntryKey, or undefined if not found.
 *
 * Resolution order (Obsidian-compatible), unchanged apart from the scoping:
 *  1. Exact fileSlug match — `[[project-alpha]]` → the slug we store in topics
 *  2. Title alias match    — `[[Project Alpha]]` → convenience for hand-typed links
 *
 * Deliberately resolves to an *archived* target too — this answers "what does
 * an existing link point at", not "what would I offer as a new link" (that's
 * `fileOccurrence.ts`'s `fileEntries`, which excludes archived entries).
 * Reachability of an already-linked entry must not depend on its archived
 * state.
 */
export function resolveWikilink(ref: string, roots: Roots, vaultId: string): EntryKey | undefined {
  const lower = ref.toLowerCase()
  // 1. FileSlug match (primary — what we store in topics: ["[[fileSlug]]"])
  for (const [key, meta] of roots) {
    if (meta.vaultId === vaultId && meta.fileSlug.toLowerCase() === lower) return key
  }
  // 2. Title alias
  for (const [key, meta] of roots) {
    if (meta.vaultId === vaultId && meta.title.toLowerCase() === lower) return key
  }
  return undefined
}

/**
 * Build an O(1) reverse lookup for `resolveWikilink`, partitioned by vault:
 * vaultId → (lowercased fileSlug|title → EntryKey). Encodes the same resolution
 * order — fileSlug wins over title, case-insensitive, first title wins on
 * duplicate titles — so
 * `buildResolveIndex(roots).get(vaultId)?.get(ref.toLowerCase())` equals
 * `resolveWikilink(ref, roots, vaultId)`. Callers that resolve many refs against
 * one `roots` build this once instead of paying `resolveWikilink`'s two linear
 * scans per ref.
 *
 * The outer level is the vault boundary made structural: there is no way to ask
 * this index a question that crosses one.
 */
export function buildResolveIndex(roots: Roots): Map<string, Map<string, EntryKey>> {
  const index = new Map<string, Map<string, EntryKey>>()
  const forVault = (vaultId: string): Map<string, EntryKey> => {
    let m = index.get(vaultId)
    if (!m) { m = new Map(); index.set(vaultId, m) }
    return m
  }
  // Titles first (first-in-iteration wins), then fileSlugs overwrite so a fileSlug match
  // always beats a title alias — matching resolveWikilink's fileSlug-before-title order.
  for (const [key, meta] of roots) {
    const m = forVault(meta.vaultId)
    const titleKey = meta.title.toLowerCase()
    if (!m.has(titleKey)) m.set(titleKey, key)
  }
  for (const [key, meta] of roots) {
    forVault(meta.vaultId).set(meta.fileSlug.toLowerCase(), key)
  }
  return index
}

/** Strip `[[` / `]]` brackets from a stored wikilink string, returning the raw ref. */
export function unwrapRef(stored: string): string {
  const m = stored.match(/^\[\[(.+)\]\]$/)
  return m ? m[1]! : stored
}
