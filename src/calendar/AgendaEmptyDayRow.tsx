import { memo } from 'react'

/**
 * A day forced into the agenda purely as a scroll target (the anchor day, or
 * today under the default anchor — see buildBucket in agendaSections.ts) with
 * nothing scheduled on it. The day's own badge is rendered by the preceding
 * AgendaDayHeaderRow, so this row is just the "No events" text.
 */
function AgendaEmptyDayRow() {
  return (
    <div className="flex items-center px-3.5 pb-1.5 min-h-7">
      <span className="text-sm text-muted-foreground">No events</span>
    </div>
  )
}

export default memo(AgendaEmptyDayRow)
