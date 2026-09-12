import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/badge'

interface Props {
  label: string
  collapsed: boolean
  count: number
  onToggle: () => void
}

// HEADER_H in agendaSections.ts seeds the virtualizer's initial offset from
// this box's height, so keep them in sync if the padding changes.
const baseCls = cn(
  'w-full px-3.5 pt-3.5 pb-1.5 text-xs',
  'flex items-center gap-2 bg-background text-left',
  'after:content-[""] after:flex-1 after:h-px after:bg-border',
)

// Same tint + text-chip-tint-foreground formula as the p3 (priority-3) chip
// (see HUE_CHIP in components/primitives/occurrence-variants.ts) — bg-warning
// resolves to the same swatch as bg-priority-3 in every theme (index.css
// aliases --warning to --priority-3), so this reads with the same verified
// contrast rather than the plain text-warning label/count this replaced,
// which was unreadably faint on light themes.
const chipCls = 'bg-warning/30 text-chip-tint-foreground'

/**
 * The agenda's one remaining full-width header row: the "Overdue" collapse
 * toggle. Per-day headers were replaced by inline gutter badges (see
 * DayBadge/AgendaRow's `badge` prop) — this is the sole survivor since
 * overdue pools many different days into one bucket that has no single day
 * badge to show.
 *
 * It starts **expanded** (calendar/viewState.ts, whose own comment explains
 * why), and `count` is the number of overdue *groups* — one per unfinished
 * series — not the number of occurrences behind them. See overduePool.ts.
 */
function AgendaHeaderRow({ label, collapsed, count, onToggle }: Props) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={!collapsed} className={baseCls}>
      <ChevronRight
        className={cn('size-3.5 shrink-0 transition-transform text-muted-foreground', !collapsed && 'rotate-90')}
        aria-hidden
      />
      <Badge variant="tag" className={cn(chipCls, 'font-bold tracking-[.08em] uppercase')}>
        {label}
      </Badge>
      <span className="tabular-nums font-normal text-muted-foreground">{count}</span>
    </button>
  )
}

export default memo(AgendaHeaderRow)
