import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useOpenEntry } from '@/hooks'
import { PageSkeleton } from '@/components/primitives/page-skeleton'

const BacklogView = lazy(() => import('@/calendar').then(m => ({ default: m.BacklogView })))

export const Route = createFileRoute('/_app/backlog')({
  component: BacklogPage,
})

function BacklogPage() {
  const onOpen = useOpenEntry()
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BacklogView onOpen={onOpen} />
    </Suspense>
  )
}
