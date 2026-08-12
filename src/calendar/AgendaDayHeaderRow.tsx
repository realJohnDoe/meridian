import { memo } from 'react'
import { DayBadge } from './DayBadge'

interface Props {
  date: Date
  isToday: boolean
}

/**
 * A day section's weekday/day-number badge, as its own full-width row at the
 * top of the section — not embedded in the first occurrence row's gutter
 * (the old approach). Sharing a flex row with the first card meant that
 * row's own height stretched to fit the badge whenever the card itself was
 * shorter (a single small card, e.g. no meta row), leaving visible empty
 * space in the card's shadowed back. As a standalone row it never competes
 * with a card for height.
 */
function AgendaDayHeaderRow({ date, isToday }: Props) {
  return (
    <div className="flex items-center gap-2 px-3.5 pt-3 pb-1">
      <DayBadge date={date} isToday={isToday} />
    </div>
  )
}

export default memo(AgendaDayHeaderRow)
