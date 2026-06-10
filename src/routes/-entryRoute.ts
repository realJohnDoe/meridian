import type { Occurrence, EditScope } from '../types'

/** Build TanStack Router navigate params for opening an existing entry. */
export function entryRoute(occ: Occurrence, scope?: EditScope) {
  return {
    to: '/entry/$fileSlug' as const,
    params: { fileSlug: occ.fileSlug },
    search: { date: occ.date ?? undefined, scope: scope ?? 'single' as EditScope },
  }
}
