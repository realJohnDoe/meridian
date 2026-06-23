import { warmSlugInFOM } from './fileOccurrence'
import { setData } from './storeBridge'
import { writeEntityToCache, deleteFromBackend } from './storage/sync'
import type { StoreData } from './model/storeOps'

/** Warm FOM (on slugs[0]), commit to store, and persist all slugs. */
export function commitNext(next: StoreData, slugs: string[]): void {
  warmSlugInFOM(slugs[0], next.items, next.roots)
  setData(next)
  slugs.forEach(writeEntityToCache)
}

/** Warm FOM, commit to store, persist backlink slugs, and delete primary from backend. */
export function commitDelete(next: StoreData, slug: string, backlinkSlugs: Iterable<string>): void {
  warmSlugInFOM(slug, next.items, next.roots)
  setData(next)
  for (const s of backlinkSlugs) writeEntityToCache(s)
  deleteFromBackend(slug)
}
