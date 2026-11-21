import { memo } from 'react'
import { DayBadge } from './DayBadge'

interface Props {
  date: Date
  isToday: boolean
}

/**
 * A day forced into the agenda purely as a scroll target (the anchor day, or
 * today under the default anchor — see buildBucket in agendaSections.ts) with
 * nothing scheduled on it. Same left gutter width as AgendaRow's own badge
 * column, so it lines up with real occurrence rows above and below it.
 */
function AgendaEmptyDayRow({ date, isToday }: Props) {
  return (
    // mt-3: this row's badge always starts a fresh day (see the doc comment
    // above), so it gets the same day-to-day breathing room AgendaRow's own
    // badged rows do.
    <div className="flex gap-2 px-3.5 mb-1.5 mt-3 min-h-11 items-center">
      <div className="w-9 shrink-0 flex justify-center">
        <DayBadge date={date} isToday={isToday} />
      </div>
      {/* pl-5: OccurrenceCard's pl-2 + w-1 bar + gap-2, so the text starts
          where a card's content does. */}
      <span className="pl-5 text-sm text-muted-foreground">Nothing scheduled</span>
    </div>
  )
}

export default memo(AgendaEmptyDayRow)
