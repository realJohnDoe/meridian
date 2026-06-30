import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useOpenEntry } from '@/hooks'

const NotesView = lazy(() => import('@/calendar').then(m => ({ default: m.NotesView })))

export const Route = createFileRoute('/_app/notes')({
  component: NotesPage,
})

function NotesPage() {
  const onOpen = useOpenEntry()
  return (
    <Suspense>
      <NotesView onOpen={onOpen} />
    </Suspense>
  )
}
