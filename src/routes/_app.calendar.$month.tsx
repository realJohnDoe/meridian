import { lazy, Suspense, useCallback, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO, fmtMonth, parseMonth } from '@/model'

const MonthView = lazy(() => import('@/calendar').then(m => ({ default: m.MonthView })))

export const Route = createFileRoute('/_app/calendar/$month')({
  component: CalendarPage,
})

function CalendarPage() {
  const { month: monthStr } = Route.useParams()
  const navigate = useNavigate()

  const month = useMemo(() => parseMonth(monthStr), [monthStr])

  // replace: true — paging to a neighbouring month is view state, not a
  // navigation event; mobile calendar conventions (Apple/Google/Outlook/
  // Fantastical) don't let a paging gesture push a back-stack entry per month.
  const onNavigateMonth = useCallback(
    (d: Date) => navigate({ to: '/calendar/$month', params: { month: fmtMonth(d) }, replace: true }),
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
