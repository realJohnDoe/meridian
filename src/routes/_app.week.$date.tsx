import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO, weekStartsOn } from '@/model'
import { useStore } from '@/store'
import { useOpenEntry } from '@/hooks'
import { setCurrentWeekKeepingWeekday, useQuickNavBrowsePreview, setQuickNavBrowsePreview } from '@/calendar'
import { PageSkeleton } from '@/components/primitives/page-skeleton'
import { newEntryRoute } from './-entryRoute'

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

  // Keeps the cross-view "current date" in sync with whichever week this
  // route is showing, preserving the weekday rather than jumping to the
  // week's first day — mount, chevron nav, and carousel swipe-commit all go
  // through this param — so the sidebar's Day switch lands on the same
  // weekday rather than resetting to the week's Monday. `date` need not
  // already be week-start-normalized (see WeekView); setCurrentWeekKeepingWeekday
  // normalizes it internally.
  useEffect(() => setCurrentWeekKeepingWeekday(date, ws), [date, ws])

  const onOpen = useOpenEntry()
  // replace: true — paging to a neighbouring week is view state, not a
  // navigation event; mirrors the day/month carousels' onNavigate*.
  const onNavigateWeek = useCallback(
    (d: Date) => navigate({ to: '/week/$date', params: { date: fmtISO(d) }, replace: true }),
    [navigate],
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
