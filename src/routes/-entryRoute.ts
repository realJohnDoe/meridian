import type { Occurrence, EditScope } from '../types'

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
