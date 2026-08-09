import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO, weekStartsOn } from '@/model'
import { useStore } from '@/store'
import { useOpenEntry } from '@/hooks'
import { setCurrentWeekKeepingWeekday } from '@/calendar'
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

  const wvDate = useMemo(() => new Date(date + 'T00:00:00'), [date])

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
