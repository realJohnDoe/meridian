import type { StoreItem } from './types'
import { isRootNode } from './types'

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
 * Resolve a wikilink ref to the per-file root node.
 *
 * Resolution order (Obsidian-compatible):
 *  1. Exact fileSlug match — `[[project-alpha]]` → root node with fileSlug "project-alpha"
 *  2. Title alias match    — `[[Project Alpha]]` → same node via its display title
 *
 * Always resolves to the file root node so callers work at file granularity.
 */
export function resolveWikilink(ref: string, items: StoreItem[]): StoreItem | undefined {
  const lower = ref.toLowerCase()
  // 1. FileSlug match (primary — what we store in topics: ["[[fileSlug]]"])
  const bySlug = items.find(i => isRootNode(i) && i.fileSlug.toLowerCase() === lower)
  if (bySlug) return bySlug
  // 2. Title alias (convenience for hand-typed links like [[Project Alpha]])
  return items.find(i => isRootNode(i) && i.metadata.title.toLowerCase() === lower)
}

/** Strip `[[` / `]]` brackets from a stored wikilink string, returning the raw ref. */
export function unwrapRef(stored: string): string {
  const m = stored.match(/^\[\[(.+)\]\]$/)
  return m ? m[1] : stored
}
