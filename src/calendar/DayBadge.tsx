import { cn } from '@/lib/cn'
import { BADGE_CLASS } from './MonthGrid'

interface Props {
  date: Date
  isToday: boolean
  className?: string
}

/**
 * Weekday abbreviation over a day-of-month badge, highlighted when `date` is
 * today — the corner indicator originally built for DayPane's gutter, now
 * shared with WeekPane and the agenda's per-day rows so "which day is this"
 * reads the same way across every view.
 */
export function DayBadge({ date, isToday, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center gap-0.5', className)}>
      <span className="text-2xs font-semibold tracking-[.06em] uppercase text-muted-foreground">
        {date.toLocaleDateString(undefined, { weekday: 'short' })}
      </span>
      <span className={cn(
        BADGE_CLASS, 'text-base w-7 h-7',
        // The fixed w-7 h-7 box exists for the today circle to sit in; its
        // vertical centering leaves visible air above a plain (non-today)
        // number that the circle's own visual weight otherwise justifies.
        // Pull the number up to close that gap when there's no circle to
        // fill it.
        isToday ? 'bg-primary text-primary-foreground font-bold' : '-mt-1',
      )}>
        {date.getDate()}
      </span>
    </div>
  )
}
