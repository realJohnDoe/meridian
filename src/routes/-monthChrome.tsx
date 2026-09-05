import { useCallback } from 'react'
import { useMatch, useNavigate } from '@tanstack/react-router'
import { fmtTopBarMonth } from '@/format'
import { fmtMonth, parseMonth } from '@/model'
import { useToday } from '@/hooks'
import { useMonthPreview, MonthStrip } from '@/calendar'
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
  const match = useMatch({ from: '/_app/calendar/$month', shouldThrow: false })

  // Shared by the month strip's chip taps — same replace: true paging
  // semantics as the chevrons below and as the swipe carousel.
  const navigateToMonth = useCallback(
    (d: Date) => navigate({ to: '/calendar/$month', params: { month: fmtMonth(d) }, replace: true }),
    [navigate],
  )

  const monthViewDate = match ? parseMonth(match.params.month) : null
  // monthPreview (set by the swipe carousel on touchend / crossing the
  // halfway point) shows the label the gesture is heading toward immediately,
  // ahead of the route committing — chevron navigation and Today still key
  // off the route's own monthViewDate.
  const monthDisplayDate = monthViewDate && previewAware(monthViewDate, monthPreview, parseMonth)
  if (!monthViewDate || !monthDisplayDate) return null

  return {
    kind: 'month',
    label: fmtTopBarMonth(monthDisplayDate, today),
    paging: {
      unit: 'month',
      onPrev: () => void navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1)) }, replace: true }),
      onNext: () => void navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1)) }, replace: true }),
    },
    onToday: () => void navigate({ to: '/calendar/$month', params: { month: fmtMonth(today) } }),
    quickNav: () => <MonthStrip activeMonth={monthDisplayDate} onNavigateMonth={navigateToMonth} />,
  }
}
