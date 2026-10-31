import { useMatch, useNavigate } from '@tanstack/react-router'
import { fmtTopBarMonth } from '@/format'
import { fmtISO, parseMonth } from '@/model'
import { useToday } from '@/hooks'
import { useMonthPreview, MonthStrip, monthDayKeptDate } from '@/calendar'
import { previewAware, type ViewChrome } from './-viewChrome'

/**
 * The month view's own answer to `ViewChrome`. Its quick-nav panel is the one
 * that isn't a `MiniMonth`: a month grid navigating by another month grid
 * would be redundant, so it shows MonthStrip's scrollable chip row instead —
 * which is also why `monthNav` (a MiniMonth-only concern) goes unused here.
 */
export function useMonthChrome(): ViewChrome | null {
  const navigate = useNavigate()
  const today = useToday()
  const monthPreview = useMonthPreview()
  const match = useMatch({ from: '/_app/calendar/$date', shouldThrow: false })
  if (!match) return null
  const routeDate = match.params.date

  // Shared by the chevrons and the month strip's chip taps — same replace:
  // true paging semantics as the swipe carousel, and the same kept
  // day-of-month (see CalendarPage).
  const navigateToMonth = (d: Date) =>
    void navigate({ to: '/calendar/$date', params: { date: monthDayKeptDate(fmtISO(d), routeDate) }, replace: true })

  const monthViewDate = parseMonth(routeDate)
  // monthPreview (set by the swipe carousel on touchend / crossing the
  // halfway point) shows the label the gesture is heading toward immediately,
  // ahead of the route committing — chevron navigation and Today still key
  // off the route's own monthViewDate.
  const monthDisplayDate = previewAware(monthViewDate, monthPreview, parseMonth)

  return {
    kind: 'month',
    label: fmtTopBarMonth(monthDisplayDate, today),
    paging: {
      unit: 'month',
      onPrev: () => navigateToMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1)),
      onNext: () => navigateToMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1)),
    },
    onToday: () => void navigate({ to: '/calendar/$date', params: { date: fmtISO(today) } }),
    quickNav: () => <MonthStrip activeMonth={monthDisplayDate} onNavigateMonth={navigateToMonth} />,
  }
}
