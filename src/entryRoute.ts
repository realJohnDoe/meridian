// A root leaf, not `routes/` — these three functions build TanStack Router
// Link/navigate descriptors from domain values (an `EntryKey`, an
// `Occurrence`), but touch no React and no live router state, so nothing
// about them needs to sit beside the route *components*. `editor/`,
// `hooks/useOpenEntry.ts`, and `components/` (`SearchBar.tsx`, `Sidebar.tsx`)
// all need them, and `routes/` itself imports all three of those to compose
// its pages — so when this lived at `routes/-entryRoute.ts`, every one of
// those three modules importing it created a cycle back through `routes/`.
// See plans/import-cycles.md for the audit that found it.
import type { Occurrence, EditScope } from '@/types'
import { parseEntryKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'

/**
 * The fields `newEntryRoute` reads off `editor/useEntryEditor.ts`'s
 * `NewEntrySeed` — deliberately a narrower, LOCAL structural type rather than
 * importing that one: `NewEntrySeed` is genuinely editor-owned (its `seed`
 * threads through `useEntryEditor`'s own state init, not just this URL), and
 * importing it back would recreate the very cycle this file exists to avoid
 * — `import type` is erased at runtime, but tools that build the *file*
 * graph rather than the *runtime* graph (this codebase's own audit used
 * `madge`, see plans/import-cycles.md) don't know that, and count it anyway.
 * Every real caller passes a `NewEntrySeed` object literal, which already
 * satisfies this narrower shape structurally — nothing else has to change.
 */
interface RouteSeed {
  date?:     string
  time?:     string
  duration?: string
  itemType?: 'task' | 'event' | 'note'
  vault?:    string
}

export function newEntryRoute(title?: string, seed?: RouteSeed) {
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
    // them apart, so _entry.entry.$vault.$slug.tsx matches on it when present.
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
