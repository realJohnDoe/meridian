import { useState } from 'react'
import { useIsTouchDevice, useResetOnChange } from '@/hooks'
import { addDays } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { parseDateString, fmtISO, serialiseInterval } from '@/model'
import type { Scheduled } from '@/types'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
} from '@/components/ui/responsive-modal'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { badgeVariants } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { NumberUnitInput } from './NumberUnitInput'
import DatePickerDialog from './DatePickerDialog'
import TimePickerDialog from './TimePickerDialog'
import { parseDuration } from '@/model'
import {
  durationToEndDate, durationToEndDateTime, fmtEndDate, fmtEndTime,
  endDateToDuration, endDateTimeToDuration, fmtDurationCompact,
} from '@/format'
import { useStore } from '@/store'

// ── Types / data ──────────────────────────────────────────────────────────────
const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
type Unit = typeof UNITS[number]
type Tab  = 'interval' | 'endDate'

const PRESETS: { label: string; value: string }[] = [
  { label: '15m', value: '15 minutes' },
  { label: '30m', value: '30 minutes' },
  { label: '45m', value: '45 minutes' },
  { label: '1h',  value: '1 hour'    },
  { label: '2h',  value: '2 hours'   },
]

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  value: string
  scheduled: Scheduled | null
  itemType: 'task' | 'event' | 'note'
  onConfirm: (duration: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function DurationDialog({ open, value, scheduled, itemType, onConfirm, onRemove, onClose }: Props) {
  const hour12  = useStore(s => s.localePrefs.hour12)
  const hasTime = !!scheduled?.time

  function defaultTab(): Tab {
    return (!scheduled || itemType === 'task') ? 'interval' : 'endDate'
  }

  const [tab,  setTab]  = useState<Tab>(defaultTab)
  const [n,    setN]    = useState(1)
  const [unit, setUnit] = useState<Unit>('hours')
  const [endDate, setEndDate] = useState('')   // YYYY-MM-DD
  const [endTime, setEndTime] = useState('')   // HH:MM
  const [dateDlgOpen, setDateDlgOpen] = useState(false)
  const [timeDlgOpen, setTimeDlgOpen] = useState(false)
  const isTouch = useIsTouchDevice()

  useResetOnChange([open, value, scheduled?.date, scheduled?.time], () => {
    if (!open) return
    const parsed = value ? parseDuration(value) : null
    setN(parsed?.n ?? 1)
    setUnit(parsed?.unit ?? 'hours')
    setTab(defaultTab())
    if (!scheduled) return
    if (hasTime) {
      const end = value
        ? durationToEndDateTime(scheduled.date, scheduled.time, value)
        : durationToEndDateTime(scheduled.date, scheduled.time, '1 hour')
      setEndDate(end.date)
      setEndTime(end.time)
    } else {
      setEndDate(value
        ? durationToEndDate(scheduled.date, value)
        : fmtISO(addDays(parseDateString(scheduled.date) ?? new Date(), 1)))
    }
  })

  function switchTab(next: Tab) {
    if (next === tab || !scheduled) return
    if (next === 'endDate') {
      const dur = serialiseInterval(Math.max(1, n), unit)
      if (hasTime) {
        const end = durationToEndDateTime(scheduled.date, scheduled.time, dur)
        setEndDate(end.date); setEndTime(end.time)
      } else {
        const converted = durationToEndDate(scheduled.date, dur)
        setEndDate(converted !== scheduled.date
          ? converted
          : fmtISO(addDays(parseDateString(scheduled.date) ?? new Date(), 1)))
      }
    } else {
      const dur = hasTime
        ? endDateTimeToDuration(scheduled.date, scheduled.time, endDate, endTime)
        : endDateToDuration(scheduled.date, endDate)
      const p = dur ? parseDuration(dur) : null
      setN(p?.n ?? 1); setUnit(p?.unit ?? 'hours')
    }
    setTab(next)
  }

  const computedDuration = scheduled
    ? (hasTime
        ? endDateTimeToDuration(scheduled.date, scheduled.time, endDate, endTime)
        : endDateToDuration(scheduled.date, endDate))
    : null

  function getChipLabel(t: Tab): string {
    if (t === tab || !scheduled) return t === 'interval' ? 'Interval' : endDateTabLabel
    if (t === 'endDate' && n >= 1) {
      const dur = serialiseInterval(n, unit)
      if (hasTime) {
        const end = durationToEndDateTime(scheduled.date, scheduled.time, dur)
        return `${endDateTabLabel} (${fmtEndDate(end.date)} ${fmtEndTime(end.time, hour12)})`
      }
      const endDateStr = durationToEndDate(scheduled.date, dur)
      if (endDateStr !== scheduled.date) return `${endDateTabLabel} (${fmtEndDate(endDateStr)})`
    }
    if (t === 'interval' && computedDuration) {
      return `Interval (${fmtDurationCompact(computedDuration)})`
    }
    return t === 'interval' ? 'Interval' : endDateTabLabel
  }

  function handleSet() {
    const dur = tab === 'interval' ? serialiseInterval(Math.max(1, n), unit) : computedDuration
    if (!dur) return
    onConfirm(dur); onClose()
  }

  const endDateTabLabel = hasTime ? 'End date & time' : 'End date'

  return (
    <>
    <ResponsiveModal open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveModalContent>
        <ResponsiveModalTitle>Duration</ResponsiveModalTitle>
        <ResponsiveModalDescription>
          Set a duration by entering an interval or picking an end date
        </ResponsiveModalDescription>

        <div className="px-4 pt-4 pb-4 space-y-4">

          {/* Select-by toggle — only shown when a date is set */}
          {scheduled && <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Select by</p>
            <ToggleGroup
              type="single"
              value={tab}
              onValueChange={(v) => { if (v) switchTab(v as Tab) }}
              className="flex gap-0.75 bg-secondary rounded-full p-0.75 border border-input w-fit"
            >
              {(['interval', 'endDate'] as Tab[]).map(t => (
                <ToggleGroupItem
                  key={t}
                  value={t}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-muted-foreground',
                    'cursor-pointer transition-all whitespace-nowrap h-auto min-w-0',
                    'data-[state=on]:bg-background data-[state=on]:text-secondary-foreground data-[state=on]:[box-shadow:0_1px_4px_rgb(0_0_0/.35)]',
                  )}
                >
                  {getChipLabel(t)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>}

          {/* Quick presets — interval tab only */}
          {tab === 'interval' && (
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map(p => (
                <button
                  key={p.value}
                  className={cn(
                    badgeVariants({ variant: 'chip' }),
                    'cursor-pointer',
                    serialiseInterval(Math.max(1, n), unit) === p.value && 'bg-primary/20 text-primary border-primary',
                  )}
                  onClick={() => { onConfirm(p.value); onClose() }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Interval */}
          {tab === 'interval' && (
            <div className="space-y-2">
              <NumberUnitInput
                n={n}
                onNChange={setN}
                unit={unit}
                units={UNITS}
                onUnitChange={setUnit}
                unitLabel={(u, count) => (count === 1 ? u.replace(/s$/, '') : u)}
              />
            </div>
          )}

          {/* End date — popover date picker + time input */}
          {tab === 'endDate' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  className="flex-1 flex items-center justify-between bg-background border border-border/50 hover:border-border focus:border-primary focus:outline-none rounded-lg px-3 h-control text-sm font-normal text-foreground transition-colors"
                  onClick={() => setDateDlgOpen(true)}
                >
                  <span className={endDate ? '' : 'text-muted-foreground'}>
                    {endDate ? fmtEndDate(endDate) : 'End date'}
                  </span>
                  <CalendarIcon size={13} className="text-muted-foreground shrink-0" />
                </button>

                {hasTime && isTouch && (
                  <button
                    className="bg-background border border-border/50 hover:border-border focus:border-primary focus:outline-none rounded-lg px-3 h-control text-sm font-mono text-foreground transition-colors"
                    onClick={() => setTimeDlgOpen(true)}
                  >
                    {endTime || '—'}
                  </button>
                )}
                {hasTime && !isTouch && (
                  <Input
                    type="time"
                    step={300}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="bg-background text-sm appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                  />
                )}
              </div>
              {!computedDuration && endDate && (
                <p className="text-xs text-destructive">End must be after start</p>
              )}
            </div>
          )}
        </div>

        <ResponsiveModalActions
          onRemove={() => { onRemove(); onClose() }}
          onCancel={onClose}
          onSet={handleSet}
          setDisabled={tab === 'endDate' ? !computedDuration : n < 1}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
    <DatePickerDialog
      open={dateDlgOpen}
      initialDate={endDate || scheduled?.date || ''}
      onConfirm={(d) => setEndDate(d)}
      onRemove={() => setEndDate('')}
      onClose={() => setDateDlgOpen(false)}
      forceDialog
    />
    <TimePickerDialog
      open={timeDlgOpen}
      value={endTime || '09:00'}
      onConfirm={(t) => setEndTime(t)}
      onRemove={() => setEndTime('')}
      onClose={() => setTimeDlgOpen(false)}
    />
    </>
  )
}
