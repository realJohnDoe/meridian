// The search bar's matcher: whole query words, as case- and accent-insensitive
// word prefixes, over title, tags and body. Deliberately not `rankByQuery`
// (lib/matching.ts): that letter-subsequence matcher is the quick-switcher
// pattern for short known names (ItemsPicker, ListedOnRow), wrong for content.

export interface SearchableEntry { title: string; tags: string[]; body?: string }
export interface SearchHit<T> { entry: T; snippet?: string }

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const wordsOf = (s: string) => fold(s).match(/[\p{L}\p{N}]+/gu) ?? []
const hasPrefix = (words: string[], q: string) => words.some(w => w.startsWith(q))

/** Rank 0 title, 1 tag, 2 body: the best field a query word is found in. */
function fieldRank(q: string, e: SearchableEntry): number {
  if (hasPrefix(wordsOf(e.title), q)) return 0
  if (e.tags.some(t => hasPrefix(wordsOf(t), q))) return 1
  if (e.body && hasPrefix(wordsOf(e.body), q)) return 2
  return -1
}

/**
 * Entries where every query word matches, best field first (an entry ranks by
 * its weakest word). Entries that reached a body hit carry the first body line
 * containing a query word as `snippet`. Stable within a rank.
 */
export function searchEntries<T extends SearchableEntry>(query: string, entries: T[]): SearchHit<T>[] {
  const qs = wordsOf(query)
  if (!qs.length) return []
  const hits: { hit: SearchHit<T>; rank: number }[] = []
  for (const entry of entries) {
    let rank = 0
    for (const q of qs) {
      const r = fieldRank(q, entry)
      if (r < 0) { rank = -1; break }
      rank = Math.max(rank, r)
    }
    if (rank < 0) continue
    const snippet = rank === 2
      ? entry.body?.split('\n').find(l => qs.some(q => hasPrefix(wordsOf(l), q)))?.trim()
      : undefined
    hits.push({ hit: { entry, snippet }, rank })
  }
  return hits.sort((a, b) => a.rank - b.rank).map(h => h.hit)
}

/** Splits `text` into alternating plain / matching runs (odd indices match) for highlighting. */
export function highlightParts(query: string, text: string): string[] {
  const qs = wordsOf(query)
  const parts: string[] = []
  let at = 0
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (!qs.some(q => fold(m[0]).startsWith(q))) continue
    parts.push(text.slice(at, m.index), m[0])
    at = m.index + m[0].length
  }
  parts.push(text.slice(at))
  return parts
}
