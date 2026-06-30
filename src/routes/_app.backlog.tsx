import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useOpenEntry } from '@/hooks'

const BacklogView = lazy(() => import('@/calendar').then(m => ({ default: m.BacklogView })))

export const Route = createFileRoute('/_app/backlog')({
  component: BacklogPage,
})

function BacklogPage() {
  const onOpen = useOpenEntry()
  return (
    <Suspense>
      <BacklogView onOpen={onOpen} />
    </Suspense>
  )
}
