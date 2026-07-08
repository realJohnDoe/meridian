import type { Occurrence, EditScope } from '@/types'

export interface NewEntrySeed {
  date?: string
  time?: string
  duration?: string
  itemType?: 'task' | 'event' | 'note'
}

export function newEntryRoute(title?: string, seed?: NewEntrySeed) {
  return {
    to: '/entry/new' as const,
    search: {
      title: title ?? undefined,
      date: seed?.date ?? undefined,
      time: seed?.time ?? undefined,
      duration: seed?.duration ?? undefined,
      itemType: seed?.itemType ?? undefined,
    },
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
