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
    <div className="flex gap-2 px-3.5 mb-1.5 min-h-11 items-center">
      <div className="w-9 shrink-0 flex justify-center">
        <DayBadge date={date} isToday={isToday} />
      </div>
      <span className="text-sm text-muted-foreground">No events</span>
    </div>
  )
}

export default memo(AgendaEmptyDayRow)
