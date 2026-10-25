import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useOpenEntry } from '@/hooks'
import { PageSkeleton } from '@/components/primitives/page-skeleton'

const UnscheduledView = lazy(() => import('@/calendar').then(m => ({ default: m.UnscheduledView })))

export const Route = createFileRoute('/_app/unscheduled')({
  component: UnscheduledPage,
})

function UnscheduledPage() {
  const onOpen = useOpenEntry()
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UnscheduledView onOpen={onOpen} />
    </Suspense>
  )
}
