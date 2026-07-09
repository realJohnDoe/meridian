import type { Occurrence, Roots, StoreItem } from '@/types'
import { isStandaloneOcc } from '@/types'
import { joinFileMeta } from '@/model'

// Materialize the undated standalone entries (date === '') as full Occurrences.
// The calendar expansion deliberately drops these — it requires a jsTime — so the
// Backlog/Notes views read them straight from the store and join the file metadata
// the same way fileOccurrence.ts does for its representative-occurrence lookup.
export function undatedOccs(items: StoreItem[], roots: Roots): Occurrence[] {
  const out: Occurrence[] = []
  for (const i of items) {
    if (isStandaloneOcc(i) && i.date === '') {
      out.push({ ...i, metadata: joinFileMeta(i.fileSlug, i.metadata, roots) })
    }
  }
  return out
}
