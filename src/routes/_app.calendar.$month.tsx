import { lazy, Suspense, useCallback, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO, fmtMonth, parseMonth } from '@/model/dateUtils'

const MonthView = lazy(() => import('@/calendar/MonthView'))

export const Route = createFileRoute('/_app/calendar/$month')({
  component: CalendarPage,
})

function CalendarPage() {
  const { month: monthStr } = Route.useParams()
  const navigate = useNavigate()

  const month = useMemo(() => parseMonth(monthStr), [monthStr])

  const onNavigateMonth = useCallback(
    (d: Date) => navigate({ to: '/calendar/$month', params: { month: fmtMonth(d) } }),
    [navigate],
  )
  const onDayClick = useCallback(
    (d: Date) => navigate({ to: '/day/$date', params: { date: fmtISO(d) } }),
    [navigate],
  )

  return (
    <Suspense>
      <MonthView
        month={month}
        onNavigateMonth={onNavigateMonth}
        onDayClick={onDayClick}
      />
    </Suspense>
  )
}
