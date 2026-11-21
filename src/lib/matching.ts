// Fuzzy subsequence matcher shared by the free-text file/item pickers (item
// picker, "listed on" picker). The search bar has its own word matcher,
// search/searchMatch.ts: this one is for short known names, not content.

function matchesQuery(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase(), t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++
  return qi === q.length
}

function scoreQuery(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase()
  let score = 0, qi = 0, cons = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { qi++; cons++; score += cons } else { cons = 0 }
  }
  if (t.startsWith(q)) score += 100
  return score
}

/**
 * Filters `items` to those whose `getFilterText` matches `query` (subsequence),
 * then sorts by `scoreQuery` on `getScoreText` (defaults to `getFilterText`),
 * best match first. Shared by every free-text file/item picker so ranking
 * stays consistent across surfaces.
 */
export function rankByQuery<T>(
  query:          string,
  items:          T[],
  getFilterText:  (item: T) => string,
  getScoreText:   (item: T) => string = getFilterText,
): T[] {
  return items
    .filter(item => matchesQuery(query, getFilterText(item)))
    .sort((a, b) => scoreQuery(query, getScoreText(b)) - scoreQuery(query, getScoreText(a)))
}
