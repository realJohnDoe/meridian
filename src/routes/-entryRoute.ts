import type { Occurrence, EditScope } from '@/types'

export function newEntryRoute(title?: string) {
  return {
    to: '/entry/new' as const,
    search: { title: title ?? undefined },
  }
}

export function entryRoute(occ: Occurrence, scope?: EditScope) {
  return {
    to: '/entry/$slug' as const,
    params: { slug: occ.fileSlug },
    search: { date: occ.date ?? undefined, scope: scope ?? 'single' as EditScope },
  }
}

export function slugRoute(fileSlug: string) {
  return {
    to: '/entry/$slug' as const,
    params: { slug: fileSlug },
    search: {} as { date?: string; scope?: EditScope },
  }
}
