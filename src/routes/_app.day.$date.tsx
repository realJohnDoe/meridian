import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { fmtISO } from '@/model'
import { useOpenEntry } from '@/hooks'
import { setCurrentDate, useQuickNavBrowsePreview, setQuickNavBrowsePreview } from '@/calendar'
import { PageSkeleton } from '@/components/primitives/page-skeleton'
import { newEntryRoute } from '@/entryRoute'

const DayView = lazy(() => import('@/calendar').then(m => ({ default: m.DayView })))

export const Route = createFileRoute('/_app/day/$date')({
  component: DayPage,
})

function DayPage() {
  const navigate = useNavigate()
  const { date } = Route.useParams()

  // While the quick-nav mini month grid is being swiped, show the date it's
  // previewing instead of this route's own param — see quickNavBrowsePreview's
  // doc comment in viewState.ts for why (avoiding a route commit on every
  // swipe frame) and why this alone is enough: DayView's own carousel
  // recenters on any `date` prop change regardless of its source, and
  // mounting a fresh centre pane here is cheap either way (see DayPane's
  // `live` prop).
  const quickNavPreview = useQuickNavBrowsePreview()
  const dvDate = useMemo(
    () => new Date((quickNavPreview ?? date) + 'T00:00:00'),
    [date, quickNavPreview],
  )

  // Hands preview control back to the route the moment it catches up to
  // match — comparing strings, not Dates, so this only fires once the real
  // navigation (fired on commit, see MiniMonth's onBrowseMonth) has actually
  // landed, never a render early. Until then dvDate above keeps tracking the
  // preview, not this (stale) route param.
  useEffect(() => {
    if (quickNavPreview !== null && quickNavPreview === date) setQuickNavBrowsePreview(null)
  }, [quickNavPreview, date])

  // Keeps the cross-view "current date" in sync with whichever day this route
  // is showing — mount, chevron nav, and carousel swipe-commit all go through
  // this param — so the sidebar lands here again after a detour elsewhere.
  useEffect(() => setCurrentDate(date), [date])

  const onOpen = useOpenEntry()
  // replace: true — paging to a neighbouring day is view state, not a
  // navigation event; mirrors the month carousel's onNavigateMonth.
  const onNavigateDate = useCallback(
    (d: Date) => navigate({ to: '/day/$date', params: { date: fmtISO(d) }, replace: true }),
    [navigate],
  )
  const onCreate = useCallback(
    (d: Date, time: string, duration: string) =>
      navigate(newEntryRoute(undefined, { date: fmtISO(d), time, duration, itemType: 'event' })),
    [navigate],
  )

  return (
    <Suspense fallback={<PageSkeleton />}>
      <DayView
        date={dvDate}
        onOpen={onOpen}
        onNavigateDate={onNavigateDate}
        onCreate={onCreate}
      />
    </Suspense>
  )
}
