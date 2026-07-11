import { lazy, Suspense, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { useEntryEditor } from '@/editor'
import { SyncButton } from '@/components'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTopbarSlot } from './-topbarSlot'

const EditorShell = lazy(() => import('@/editor').then(m => ({ default: m.EditorShell })))

function EntrySkeleton() {
  return (
    <div className="flex-1 flex flex-col gap-3 px-3.5 pt-5 lg:max-w-3xl lg:mx-auto w-full">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )
}

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

function NewEntryTopbar({ onBack }: { onBack: () => void }) {
  const slotEl = useTopbarSlot()
  if (!slotEl) return null
  return createPortal(
    <div className="flex items-center gap-1 w-full lg:max-w-3xl lg:mx-auto px-3.5">
      <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0 lg:hidden" onClick={onBack} title="Back" aria-label="Back">
        <ArrowLeft size={18} />
      </Button>
      <div className="flex-1" />
      <SyncButton />
    </div>,
    slotEl,
  )
}

function NewEntryReady({ title, date, time, duration, itemType }: NewEntrySearch) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const hooks = useEntryEditor(null, 'all', title, { date, time, duration, itemType })

  return (
    <>
      <NewEntryTopbar onBack={hooks.handleClose} />
      <Suspense fallback={<EntrySkeleton />}>
        <EditorShell entry={hooks.entry} hooks={hooks} items={items} roots={roots} />
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
