import type { StoreItem } from './types'

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

export function resolveWikilink(ref: string, items: StoreItem[]): StoreItem | undefined {
  const lower = ref.toLowerCase()
  return items.find(i => i.metadata.title.toLowerCase() === lower)
}
