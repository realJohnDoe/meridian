import { lazy, Suspense, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@/store'
import { useEntryEditor } from '@/editor'
import { EntrySkeleton } from '@/components/primitives/entry-skeleton'
import { titleToSlug, entryKey as makeEntryKey } from '@/fileIO'
import { EntryTopbar } from './-entryTopbar'

const EntryEditor = lazy(() => import('@/editor').then(m => ({ default: m.EntryEditor })))

type ItemTypeSearch = 'task' | 'event' | 'note'
const ITEM_TYPES: ItemTypeSearch[] = ['task', 'event', 'note']

interface NewEntrySearch {
  title?: string
  date?: string
  time?: string
  duration?: string
  itemType?: ItemTypeSearch
}

export const Route = createFileRoute('/_app/entry/new')({
  component: NewEntryPage,
  validateSearch: (s: Record<string, unknown>): NewEntrySearch => ({
    title: typeof s.title === 'string' ? s.title : undefined,
    date: typeof s.date === 'string' ? s.date : undefined,
    time: typeof s.time === 'string' ? s.time : undefined,
    duration: typeof s.duration === 'string' ? s.duration : undefined,
    itemType: ITEM_TYPES.includes(s.itemType as ItemTypeSearch) ? (s.itemType as ItemTypeSearch) : undefined,
  }),
})

function NewEntryReady({ title, date, time, duration, itemType }: NewEntrySearch) {
  const items          = useStore(s => s.items)
  const roots          = useStore(s => s.roots)
  const favorites      = useStore(s => s.favorites)
  const toggleFavorite = useStore(s => s.toggleFavorite)
  const hooks = useEntryEditor(null, 'all', title, { date, time, duration, itemType })

  // A brand-new item has no file yet, but once it has a title its eventual key is
  // predictable, so favoriting can target it immediately rather than waiting for
  // autosave. `titleToSlug` is only the estimate — once the first save has landed,
  // `createdKey` is the key the file actually got (they differ when the title
  // slugifies onto one another file already owns).
  const estimatedKey = hooks.vaultId && hooks.entry.title
    ? makeEntryKey(hooks.vaultId, titleToSlug(hooks.entry.title))
    : null
  const effectiveKey = hooks.entry.item?.entryKey ?? hooks.createdKey ?? estimatedKey
  const isFavorited = !!effectiveKey && favorites.includes(effectiveKey)

  return (
    <>
      <EntryTopbar
        isFavorited={isFavorited}
        onToggleFavorite={effectiveKey ? () => toggleFavorite(effectiveKey) : null}
        onDelete={hooks.handleDelete}
        onBack={hooks.handleClose}
      />
      <Suspense fallback={<EntrySkeleton />}>
        <EntryEditor hooks={hooks} items={items} roots={roots} />
      </Suspense>
    </>
  )
}

function NewEntryPage() {
  const search = Route.useSearch()
  const { title } = search
  const key = useMemo(() => `new-${title ?? ''}`, [])  // eslint-disable-line react-hooks/exhaustive-deps
  return <NewEntryReady key={key} {...search} />
}
