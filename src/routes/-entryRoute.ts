import type { Occurrence, EditScope } from '@/types'
import type { NewEntrySeed } from '@/editor'
import { parseEntryKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'

export function newEntryRoute(title?: string, seed?: NewEntrySeed) {
  return {
    to: '/entry/new' as const,
    search: {
      title: title ?? undefined,
      date: seed?.date ?? undefined,
      time: seed?.time ?? undefined,
      duration: seed?.duration ?? undefined,
      itemType: seed?.itemType ?? undefined,
      vault: seed?.vault ?? undefined,
    },
  }
}

// The URL carries the two halves of an EntryKey separately — `/entry/<vault>/<slug>` —
// rather than the composite string: the separator is not path-safe, and the two
// segments read as what they are. `parseEntryKey` is the only place the split
// happens, here as everywhere else.

export function entryRoute(occ: Occurrence, scope?: EditScope) {
  const { vaultId, fileSlug } = parseEntryKey(occ.entryKey)
  return {
    to: '/entry/$vault/$slug' as const,
    params: { vault: vaultId, slug: fileSlug },
    // `id` disambiguates two occurrences of the same file landing on the same
    // date (e.g. two override instances with no time) — date alone can't tell
    // them apart, so _app.entry.$vault.$slug.tsx matches on it when present.
    search: { date: occ.date, scope: scope ?? 'single', id: occ.id },
  }
}

export function keyRoute(entryKey: EntryKey) {
  const { vaultId, fileSlug } = parseEntryKey(entryKey)
  return {
    to: '/entry/$vault/$slug' as const,
    params: { vault: vaultId, slug: fileSlug },
    search: {} as { date?: string; scope?: EditScope },
  }
}
