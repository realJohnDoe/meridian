import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { fmtTopBarMonth } from '@/format'
import { fmtISO, parseDateString } from '@/model'
import { useToday, useResetOnChange } from '@/hooks'
import {
  useAgendaTopDate, useQuickNavOpen, closeQuickNav, MiniMonth,
  requestScrollToToday, requestScrollToDate,
} from '@/calendar'
import type { ViewChrome } from './-viewChrome'

/**
 * The agenda's own answer to `ViewChrome`. Unlike the other four this never
 * returns null: the agenda is the default view, mounted whenever none of the
 * named routes matched, so it is what `-useViewChrome.ts` falls back to.
 */
export function useAgendaChrome(): ViewChrome {
  const navigate = useNavigate()
  const today = useToday()
  const agendaTopDate = useAgendaTopDate()
  const quickNavOpen = useQuickNavOpen()

  // The agenda's quick-nav grid's own anchor, frozen to whatever agendaTopDate
  // was at the moment the panel opened — NOT read live thereafter. The panel's
  // own browse gesture drives requestScrollToDate, which moves the agenda's
  // scroll position and therefore agendaTopDate; feeding that live value back
  // in as anchorMonth/highlightDates re-renders MiniMonth mid-browse with a
  // changed anchorMonth, which its own useResetOnChange reads as "the parent
  // wants a different month" and yanks `month` back to it — the gesture's own
  // consequence re-steering the widget that produced it. Landing off by one
  // row (an estimate-vs-measured gap, or any future change to how the agenda
  // seeds its scroll) is enough to trigger this, and once it does, repeated
  // swipes can never advance past the first browsed month. useResetOnChange
  // (render-phase, not an effect) means this updates in the same render pass
  // `quickNavOpen` flips, so the grid still opens showing the agenda's current
  // position — it just stops tracking it once open.
  const [agendaQuickNavAnchor, setAgendaQuickNavAnchor] = useState(agendaTopDate)
  useResetOnChange([quickNavOpen], () => setAgendaQuickNavAnchor(agendaTopDate))

  // The agenda shows just the month of its topmost visible row, matching
  // Day/Week/Month's own topbar.
  const labelDate = agendaTopDate ? new Date(agendaTopDate + 'T00:00:00') : today

  return {
    kind: 'agenda',
    label: fmtTopBarMonth(labelDate, today),
    // Scrolling the list is how the agenda pages.
    paging: null,
    onToday: () => {
      requestScrollToToday()
      void navigate({ to: '/' })
    },
    quickNav: monthNav => (
      <MiniMonth
        open={quickNavOpen}
        // Frozen snapshot, not agendaTopDate directly — see
        // agendaQuickNavAnchor's own doc comment above for why.
        anchorMonth={parseDateString(agendaQuickNavAnchor) ?? today}
        highlightDates={agendaQuickNavAnchor ? [parseDateString(agendaQuickNavAnchor) ?? today] : []}
        monthNav={monthNav}
        onSelectDay={iso => {
          requestScrollToDate(iso)
          closeQuickNav()
        }}
        onBrowseMonth={d => requestScrollToDate(fmtISO(d))}
        // No onBrowseMonthPreview: unlike day/week's own decoupled preview
        // state (quickNavBrowsePreview), the agenda has nothing cheap to do
        // on preview — requestScrollToDate moves agendaAnchor and re-renders
        // the agenda's own row list, so firing it on preview *and* commit
        // doubles that work on every swipe for no benefit, since the panel's
        // own highlight (MonthStrip, the highlighted day) already tracks the
        // gesture via MiniMonth's local browsePreview state regardless. The
        // agenda behind the panel now updates once, on commit, instead of
        // live-tracking the drag — a deliberate, visible behaviour change.
      />
    ),
  }
}
