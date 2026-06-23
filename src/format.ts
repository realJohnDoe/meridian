import { addDays, isSameDay } from 'date-fns'

export { addDays, isSameDay as sameDay }

export const fmtLong  = (d: Date): string => d.toLocaleDateString('en-US', { weekday: 'long',  month: 'long',  day: 'numeric' })
export const fmtShort = (d: Date): string => d.toLocaleDateString('en-US', {                   month: 'short', day: 'numeric' })

export function fmtTopBarDay(d: Date, today: Date): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

export function fmtTopBarMonth(d: Date, today: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'long' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}
