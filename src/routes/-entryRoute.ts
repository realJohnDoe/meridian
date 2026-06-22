import type { Occurrence, EditScope } from '@/types'

/** Build TanStack Router navigate params for creating a new entry as a search-param overlay. */
export function newEntryRoute(title?: string) {
  return {
    to: '.' as const,
    search: (prev: Record<string, unknown>) => ({
      ...prev,
      editor: 'new',
      etitle: title || undefined,
      edate: undefined,
      escope: undefined,
    }),
  }
}

/** Build TanStack Router navigate params for opening an existing entry as a search-param overlay. */
export function entryRoute(occ: Occurrence, scope?: EditScope) {
  return {
    to: '.' as const,
    search: (prev: Record<string, unknown>) => ({
      ...prev,
      editor: occ.fileSlug,
      edate: occ.date ?? undefined,
      escope: scope ?? 'single' as EditScope,
      etitle: undefined,
    }),
  }
}

/** Build TanStack Router navigate params for opening an entry by fileSlug (no date context). */
export function slugRoute(fileSlug: string) {
  return {
    to: '.' as const,
    search: (prev: Record<string, unknown>) => ({
      ...prev,
      editor: fileSlug,
      edate: undefined,
      escope: undefined,
      etitle: undefined,
    }),
  }
}
