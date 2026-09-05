import { useMatch, useNavigate } from '@tanstack/react-router'
import { addDays, fmtTopBarMonth } from '@/format'
import { fmtISO, parseDateString, weekStartsOn } from '@/model'
import { useToday } from '@/hooks'
import { useStore } from '@/store'
import {
  useWeekPreview, useQuickNavOpen, closeQuickNav, MiniMonth, weekStartFor,
  firstWeekStartInMonth, useCurrentDate, setCurrentDate, weekdayKeptDate,
  setQuickNavBrowsePreview,
} from '@/calendar'
import { previewAware, type ViewChrome } from './-viewChrome'

/**
 * The week view's own answer to `ViewChrome`. The most involved of the five,
 * because a week's *label* and its *selected day* come from different sources
 * and routinely fall in different months — see the two comments below.
 */
export function useWeekChrome(): ViewChrome | null {
  const navigate = useNavigate()
  const today = useToday()
  const weekPreview = useWeekPreview()
  const quickNavOpen = useQuickNavOpen()
  const currentDate = useCurrentDate()
  const ws = weekStartsOn(useStore(s => s.localePrefs))
  const match = useMatch({ from: '/_app/week/$date', shouldThrow: false })

  // The route param need not already be week-start-normalized (see WeekView),
  // so it's normalized here before anything reads it.
  const weekStartDate = match ? weekStartFor(new Date(match.params.date + 'T00:00:00'), ws) : null
  // weekPreview (set by the swipe carousel on touchend / crossing the halfway
  // point) shows the label the gesture is heading toward immediately, ahead
  // of the route committing — chevron navigation and Today still key off the
  // route's own weekStartDate.
  const weekDisplayStart = weekStartDate && previewAware(weekStartDate, weekPreview, parseDateString)
  // currentDate carried forward into the previewed week, same weekday kept —
  // the quick-nav panel's anchor month and highlighted day both key off this
  // (see below) rather than currentDate directly, so they track a swipe in
  // progress instead of only jumping once it commits.
  const currentDisplayDate = previewAware(currentDate, weekPreview, key => weekdayKeptDate(key, currentDate, ws))
  if (!weekStartDate || !weekDisplayStart) return null

  return {
    kind: 'week',
    label: fmtTopBarMonth(weekDisplayStart, today),
    paging: {
      unit: 'week',
      onPrev: () => void navigate({ to: '/week/$date', params: { date: fmtISO(addDays(weekStartDate, -7)) }, replace: true }),
      onNext: () => void navigate({ to: '/week/$date', params: { date: fmtISO(addDays(weekStartDate, 7)) }, replace: true }),
    },
    onToday: () => {
      // WeekPage's own effect always runs the route date through
      // setCurrentWeekKeepingWeekday, which preserves the *previously*
      // selected weekday rather than adopting the target date's own — see
      // its own doc comment. Setting currentDate here first means that
      // effect reads it back as already-today and no-ops, so "Today"
      // actually lands currentDate (and the quick-nav highlight) on today
      // instead of on today's week with the old weekday kept.
      setCurrentDate(fmtISO(today))
      void navigate({ to: '/week/$date', params: { date: fmtISO(today) } })
    },
    quickNav: monthNav => (
      <MiniMonth
        open={quickNavOpen}
        // Same source as highlightDates below (currentDisplayDate),
        // not weekDisplayStart — the week's first day and the
        // actually selected day routinely fall in different months
        // (any week straddling a month boundary), and anchoring to
        // weekDisplayStart while highlighting currentDisplayDate
        // opened the panel on a month that didn't contain its own
        // highlighted day. currentDisplayDate rather than plain
        // currentDate so both track an in-progress swipe (see its
        // own comment above) instead of only jumping once it commits.
        anchorMonth={parseDateString(currentDisplayDate) ?? weekDisplayStart}
        highlightDates={[parseDateString(currentDisplayDate) ?? weekDisplayStart]}
        monthNav={monthNav}
        onSelectDay={iso => {
          // See the "Today" handler above: set currentDate directly
          // so the picked day — not the previously selected weekday
          // — is what ends up highlighted and current.
          setCurrentDate(iso)
          void navigate({ to: '/week/$date', params: { date: iso } })
          closeQuickNav()
        }}
        onBrowseMonth={d => {
          // `d` is the 1st of the browsed month, which routinely
          // isn't itself the locale's week-start weekday — landing
          // there literally would show (and label, via
          // weekDisplayStart above) whichever week contains it,
          // which can round backward into the *previous* month
          // (see firstWeekStartInMonth) and desync the topbar
          // label from the month strip highlighting the month
          // just tapped. Land on that month's first proper week
          // instead, so both agree.
          const iso = fmtISO(firstWeekStartInMonth(d, ws))
          setCurrentDate(iso)
          void navigate({ to: '/week/$date', params: { date: iso }, replace: true })
        }}
        // Same firstWeekStartInMonth landing as the commit above, computed
        // here rather than by the route file so day and week never have to
        // agree on one shared interpretation of the raw browsed date — see
        // quickNavBrowsePreview's own doc comment in viewState.ts.
        onBrowseMonthPreview={d => setQuickNavBrowsePreview(fmtISO(firstWeekStartInMonth(d, ws)))}
      />
    ),
  }
}
