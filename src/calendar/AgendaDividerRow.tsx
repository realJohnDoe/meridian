import { memo } from 'react'

interface Props {
  variant: 'month' | 'week'
  label: string
}

/**
 * The agenda's always-on month/week rulers — one row per calendar month and
 * per calendar week in the loaded window, regardless of whether that stretch
 * has anything scheduled (see the day-by-day walk in agendaSections.ts). The
 * month divider is the bigger, bolder of the two so the hierarchy reads at a
 * glance while scrolling past long empty stretches.
 */
function AgendaDividerRow({ variant, label }: Props) {
  if (variant === 'month') {
    return <div className="px-3.5 pt-6 pb-1 text-lg font-bold text-foreground">{label}</div>
  }
  return <div className="px-3.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
}

export default memo(AgendaDividerRow)
