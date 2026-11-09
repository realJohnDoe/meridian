import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useOpenEntry } from '@/hooks'
import { PageSkeleton } from '@/components/primitives/page-skeleton'
import { lazyChunk } from './-lazyChunk'

const NotesView = lazyChunk(() => import('@/calendar').then(m => m.NotesView))

export const Route = createFileRoute('/_app/notes')({
  component: NotesPage,
})

function NotesPage() {
  const onOpen = useOpenEntry()
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NotesView onOpen={onOpen} />
    </Suspense>
  )
}
