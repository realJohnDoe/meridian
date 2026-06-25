import { setData } from './storeBridge'
import { writeEntityToCache, deleteFromBackend } from '@/storage'
import type { StoreData } from '@/model'

/** Commit to store and persist all slugs. */
export function commitNext(next: StoreData, slugs: string[]): void {
  setData(next)
  slugs.forEach(writeEntityToCache)
}

/** Commit to store, persist backlink slugs, and delete primary from backend. */
export function commitDelete(next: StoreData, slug: string, backlinkSlugs: Iterable<string>): void {
  setData(next)
  for (const s of backlinkSlugs) writeEntityToCache(s)
  deleteFromBackend(slug)
}
