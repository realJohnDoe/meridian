import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO, parseMonth } from '@/model'
import { setCurrentDate, monthDayKeptDate } from '@/calendar'
import { PageSkeleton } from '@/components/primitives/page-skeleton'

const MonthView = lazy(() => import('@/calendar').then(m => ({ default: m.MonthView })))

export const Route = createFileRoute('/_app/calendar/$date')({
  // Month URLs used to carry just `YYYY-MM`; keep those links working.
  params: { parse: ({ date }) => ({ date: /^\d{4}-\d{2}$/.test(date) ? `${date}-01` : date }) },
  component: CalendarPage,
})

function CalendarPage() {
  const { date } = Route.useParams()
  const navigate = useNavigate()

  const month = useMemo(() => parseMonth(date), [date])

  // `date` is the selected day, not the month — MonthView derives the month
  // from it. The URL owns it; this only mirrors it for the sidebar.
  useEffect(() => setCurrentDate(date), [date])

  // replace: true — paging to a neighbouring month is view state, not a
  // navigation event; mobile calendar conventions (Apple/Google/Outlook/
  // Fantastical) don't let a paging gesture push a back-stack entry per month.
  // Keeps the selected day-of-month rather than jumping to the 1st.
  const onNavigateMonth = useCallback(
    (d: Date) => navigate({ to: '/calendar/$date', params: { date: monthDayKeptDate(fmtISO(d), date) }, replace: true }),
    [navigate, date],
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
