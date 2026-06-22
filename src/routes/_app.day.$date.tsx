import { lazy, Suspense, useCallback, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO } from '@/model/dateUtils'
import { useOpenEntry } from '@/hooks/useOpenEntry'

const DayView = lazy(() => import('@/calendar/DayView'))

export const Route = createFileRoute('/_app/day/$date')({
  component: DayPage,
})

function DayPage() {
  const navigate = useNavigate()
  const { date } = Route.useParams()

  const dvDate = useMemo(() => new Date(date + 'T00:00:00'), [date])

  const onOpen = useOpenEntry()
  const onNavigateDate = useCallback(
    (d: Date) => navigate({ to: '/day/$date', params: { date: fmtISO(d) } }),
    [navigate],
  )

  return (
    <Suspense>
      <DayView
        date={dvDate}
        onOpen={onOpen}
        onNavigateDate={onNavigateDate}
      />
    </Suspense>
  )
}
