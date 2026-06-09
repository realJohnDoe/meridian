import type { Occurrence } from '../types'

/** Build TanStack Router navigate params for opening an existing entry. */
export function entryRoute(occ: Occurrence, scope?: string) {
  return {
    to: '/entry/$fileSlug' as const,
    params: { fileSlug: occ.fileSlug },
    search: { date: occ.date ?? undefined, scope: scope ?? 'single' },
  }
}
