import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO, weekStartsOn } from '@/model'
import { useStore } from '@/store'
import { useOpenEntry } from '@/hooks'
import { setCurrentDate, weekdayKeptDate, useQuickNavBrowsePreview, setQuickNavBrowsePreview } from '@/calendar'
import { PageSkeleton } from '@/components/primitives/page-skeleton'
import { newEntryRoute } from '@/entryRoute'

const WeekView = lazy(() => import('@/calendar').then(m => ({ default: m.WeekView })))

export const Route = createFileRoute('/_app/week/$date')({
  component: WeekPage,
})

function WeekPage() {
  const navigate = useNavigate()
  const { date } = Route.useParams()
  const ws = weekStartsOn(useStore(s => s.localePrefs))

  // While the quick-nav mini month grid is being swiped, show the week it's
  // previewing instead of this route's own param — see quickNavBrowsePreview's
  // doc comment in viewState.ts (avoiding a route commit on every swipe
  // frame) and DayPage's matching comment for why this alone is enough.
  // Already the week-start-landed value _app.tsx's onBrowseMonthPreview
  // computed (firstWeekStartInMonth), not the raw browsed month.
  const quickNavPreview = useQuickNavBrowsePreview()
  const wvDate = useMemo(
    () => new Date((quickNavPreview ?? date) + 'T00:00:00'),
    [date, quickNavPreview],
  )

  // Hands preview control back to the route once it catches up to match —
  // see DayPage's matching effect for why comparing strings here is safe.
  useEffect(() => {
    if (quickNavPreview !== null && quickNavPreview === date) setQuickNavBrowsePreview(null)
  }, [quickNavPreview, date])

  // `date` is the selected day, not the week start — WeekView derives the
  // week from it. The URL owns it; this only mirrors it for the sidebar.
  useEffect(() => setCurrentDate(date), [date])

  const onOpen = useOpenEntry()
  // replace: true — paging to a neighbouring week is view state, not a
  // navigation event; mirrors the day/month carousels' onNavigate*. Lands on
  // the selected day's weekday in the new week, not on its first day.
  const onNavigateWeek = useCallback(
    (weekStart: Date) => navigate({ to: '/week/$date', params: { date: weekdayKeptDate(fmtISO(weekStart), date, ws) }, replace: true }),
    [navigate, date, ws],
  )
  const onDayClick = useCallback(
    (d: Date) => navigate({ to: '/day/$date', params: { date: fmtISO(d) } }),
    [navigate],
  )
  const onCreate = useCallback(
    (d: Date, time: string, duration: string) =>
      navigate(newEntryRoute(undefined, { date: fmtISO(d), time, duration, itemType: 'event' })),
    [navigate],
  )

  return (
    <Suspense fallback={<PageSkeleton />}>
      <WeekView
        date={wvDate}
        onOpen={onOpen}
        onNavigateWeek={onNavigateWeek}
        onDayClick={onDayClick}
        onCreate={onCreate}
      />
    </Suspense>
  )
}
