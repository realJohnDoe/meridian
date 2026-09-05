import { useMatch, useNavigate } from '@tanstack/react-router'
import { addDays, fmtTopBarMonth } from '@/format'
import { fmtISO, parseDateString } from '@/model'
import { useToday } from '@/hooks'
import {
  useDayPreview, useQuickNavOpen, closeQuickNav, MiniMonth, setQuickNavBrowsePreview,
} from '@/calendar'
import { previewAware, type ViewChrome } from './-viewChrome'

/**
 * The day view's own answer to `ViewChrome` — its topbar label and paging,
 * what Today does there, and the mini month grid its quick-nav panel shows.
 * Returns null when the day route isn't the one mounted, which is the only
 * place in this file the day/week/month/list/agenda discriminant is asked:
 * once, by the view it is about.
 */
export function useDayChrome(): ViewChrome | null {
  const navigate = useNavigate()
  const today = useToday()
  const dayPreview = useDayPreview()
  const quickNavOpen = useQuickNavOpen()
  const match = useMatch({ from: '/_app/day/$date', shouldThrow: false })

  const dvDate = match ? new Date(match.params.date + 'T00:00:00') : null
  // dayPreview (set by the swipe carousel on touchend / crossing the halfway
  // point) shows the label the gesture is heading toward immediately, ahead
  // of the route committing — chevron navigation and Today still key off the
  // route's own dvDate.
  const dvDisplayDate = dvDate && previewAware(dvDate, dayPreview, parseDateString)
  if (!dvDate || !dvDisplayDate) return null

  return {
    kind: 'day',
    label: fmtTopBarMonth(dvDisplayDate, today),
    paging: {
      unit: 'day',
      onPrev: () => void navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) }, replace: true }),
      onNext: () => void navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) }, replace: true }),
    },
    onToday: () => void navigate({ to: '/day/$date', params: { date: fmtISO(today) } }),
    quickNav: monthNav => (
      <MiniMonth
        open={quickNavOpen}
        anchorMonth={dvDisplayDate}
        highlightDates={[dvDisplayDate]}
        monthNav={monthNav}
        onSelectDay={iso => {
          void navigate({ to: '/day/$date', params: { date: iso } })
          closeQuickNav()
        }}
        onBrowseMonth={d => {
          // replace: true — browsing months here is view state,
          // not a navigation event, matching the carousels'
          // own commit navigations (see e.g. MonthView).
          void navigate({ to: '/day/$date', params: { date: fmtISO(d) }, replace: true })
        }}
        // Cheap, decoupled preview instead of the navigation above —
        // _app.day.$date.tsx reads this in place of its own route param
        // while it's set, so the day view tracks the swipe live without a
        // route commit on every frame. See quickNavBrowsePreview's own doc
        // comment in viewState.ts.
        onBrowseMonthPreview={d => setQuickNavBrowsePreview(fmtISO(d))}
      />
    ),
  }
}
