import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO, fmtMonth, parseMonth } from '@/model'
import { setCurrentMonthKeepingDay } from '@/calendar'
import { PageSkeleton } from '@/components/primitives/page-skeleton'

const MonthView = lazy(() => import('@/calendar').then(m => ({ default: m.MonthView })))

export const Route = createFileRoute('/_app/calendar/$month')({
  component: CalendarPage,
})

function CalendarPage() {
  const { month: monthStr } = Route.useParams()
  const navigate = useNavigate()

  const month = useMemo(() => parseMonth(monthStr), [monthStr])

  // Keeps the cross-view "current date" in sync with whichever month this
  // route is showing — mount, chevron nav, and carousel swipe-commit all go
  // through this param — so the sidebar's Day switch lands on the same
  // day-of-month rather than resetting to today.
  useEffect(() => setCurrentMonthKeepingDay(monthStr), [monthStr])

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
    <Suspense fallback={<PageSkeleton />}>
      <MonthView
        month={month}
        onNavigateMonth={onNavigateMonth}
        onDayClick={onDayClick}
      />
    </Suspense>
  )
}
