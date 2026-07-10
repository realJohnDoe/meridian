import { useState } from 'react'
import { startOfToday } from 'date-fns'
import { Info } from 'lucide-react'
import type { Repeat, Scheduled, Weekday } from '@/types'
import { fmtISO, parseDateString, weekStartsOn, parseInterval, serialiseInterval, monthlyWeekdaySpec } from '@/model'
import { useStore } from '@/store'
import { useResetOnChange } from '@/hooks'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
} from '@/components/ui/responsive-modal'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { badgeVariants } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'

// ── Types ─────────────────────────────────────────────────────────────────────

type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'after_completion'
type EndType = 'never' | 'until' | 'count'
type MonthlyMode = 'same-day' | 'weekday-pattern'

interface DialogState {
  freq: Freq
  wdays: boolean[]         // Mon–Sun, index 0–6
  monthly: MonthlyMode
  endType: EndType
  endVal: string
  interval: string
  intervalNum: number
}

interface Props {
  open: boolean
  scheduled: Scheduled | null
  tracked: boolean
  itemType?: string
  repeat: Repeat | null
  onConfirm: (repeat: Repeat) => void
  onRemove: () => void
  onClose: () => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const WDAY_CODES: Weekday[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']

// ── Dropdown options and calculations ─────────────────────────────────────────

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── State helpers ─────────────────────────────────────────────────────────────

/** Default weekday selection: the day matching `scheduledDate`, or Monday. */
function defaultWdays(scheduledDate?: string | null): boolean[] {
  const wdays = [false, false, false, false, false, false, false]
  const jsDay = parseDateString(scheduledDate ?? '') ?.getDay() ?? 1
  const monFirst = (jsDay + 6) % 7
  wdays[monFirst] = true
  return wdays
}

/** Derive initial dialog state from an existing Repeat value (or sensible defaults). */
function initState(
  repeat: Repeat | null,
  scheduled: Scheduled | null,
  hasSched: boolean,
  hasTrk: boolean,
): DialogState {
  const defaultFreq: Freq = hasTrk && !hasSched ? 'after_completion' : 'weekly'

  if (!repeat) {
    return {
      freq: defaultFreq,
      wdays: defaultWdays(scheduled?.date),
      monthly: 'same-day',
      endType: 'never',
      endVal: '',
      interval: '1 day',
      intervalNum: 1,
    }
  }

  if (repeat.type === 'after_completion') {
    return {
      freq: 'after_completion',
      wdays: defaultWdays(scheduled?.date),
      monthly: 'same-day',
      endType: 'never',
      endVal: '',
      interval: repeat.interval ?? '1 day',
      intervalNum: 1,
    }
  }

  // Scheduled repeat: reverse-engineer state from the flat spec
  const s = repeat

  // Determine monthly mode
  let monthly: MonthlyMode = 'same-day'
  if (s.byweekday && s.bysetpos !== undefined) monthly = 'weekday-pattern'

  // Determine weekday booleans
  const wdays = [false, false, false, false, false, false, false]
  if (s.freq === 'weekly' && s.byweekday) {
    WDAY_CODES.forEach((code, i) => { wdays[i] = (s.byweekday ?? []).includes(code) })
  }

  // Determine end condition
  let endType: EndType = 'never'
  let endVal = ''
  if (s.end?.type === 'until') {
    endType = 'until'
    endVal = s.end.date ?? s.end.time ?? ''
  } else if (s.end?.type === 'count') {
    endType = 'count'
    endVal = String(s.end.occurrences)
  }

  return {
    freq: s.freq,
    wdays,
    monthly,
    endType,
    endVal,
    interval: '1 day',
    intervalNum: s.interval ?? 1,
  }
}

/** Build a Repeat value from the current dialog state. */
function buildRepeat(
  freq: Freq,
  wdays: boolean[],
  monthly: MonthlyMode,
  endType: EndType,
  endVal: string,
  interval: string,
  intervalNum: number,
  scheduledDate?: string | null,
): Repeat {
  if (freq === 'after_completion') {
    return { type: 'after_completion', interval }
  }

  const r: Repeat = { 
    type: 'schedule', 
    freq: freq,
    interval: intervalNum,
  }

  if (freq === 'weekly') {
    r.byweekday = WDAY_CODES.filter((_, i) => wdays[i])
  }

  if (freq === 'monthly') {
    const d = parseDateString(scheduledDate ?? '')
    if (d) {
      if (monthly === 'same-day') {
        r.bymonthday = [d.getDate()]
      } else {
        const spec = monthlyWeekdaySpec(d)
        r.byweekday = spec.byweekday
        r.bysetpos = spec.bysetpos
      }
    }
  }

  if (endType === 'until' && endVal)  r.end = { type: 'until', date: endVal }
  if (endType === 'count' && endVal)  r.end = { type: 'count', occurrences: parseInt(endVal, 10) }

  return r
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RepeatDialog({
  open,
  scheduled,
  tracked,
  itemType,
  repeat,
  onConfirm,
  onRemove,
  onClose,
}: Props) {
  const localePrefs = useStore(s => s.localePrefs)
  // Display order for weekday toggle: rotate Mon-Sun array so first-day-of-week comes first.
  // wdays indices are always 0=Mon..6=Sun regardless of locale.
  const wdayDisplayOrder = (() => {
    const ws = weekStartsOn(localePrefs) // 0=Sun, 1=Mon, 6=Sat
    const startIdx = ws === 0 ? 6 : ws === 6 ? 5 : 0  // index in wdays array for first displayed day
    return Array.from({ length: 7 }, (_, i) => (startIdx + i) % 7)
  })()

  const hasSched = !!scheduled
  const hasTrk   = tracked && itemType !== 'event'

  const [freq,           setFreq]           = useState<Freq>('weekly')
  const [wdays,          setWdays]          = useState<boolean[]>([false, false, false, false, false, false, false])
  const [monthly,        setMonthly]        = useState<MonthlyMode>('same-day')
  const [endType,        setEndType]        = useState<EndType>('never')
  const [endVal,         setEndVal]         = useState('')
  const [intervalNum,    setIntervalNum]    = useState<number>(1)
  const [completionNum,  setCompletionNum]  = useState<number>(1)
  const [completionUnit, setCompletionUnit] = useState<string>('days')
  const [endCalOpen,     setEndCalOpen]     = useState(false)
  const [endCalMonth,    setEndCalMonth]    = useState<Date>(new Date())

  // Re-initialise whenever the dialog opens (so stale state never leaks between opens)
  useResetOnChange([open], () => {
    if (!open) return
    const s = initState(repeat, scheduled, hasSched, hasTrk)
    setFreq(s.freq)
    setWdays(s.wdays)
    setMonthly(s.monthly)
    setEndType(s.endType)
    setEndVal(s.endVal)
    setIntervalNum(s.intervalNum)

    const parsed = parseInterval(s.interval)
    setCompletionNum(parsed.n)
    setCompletionUnit(parsed.unit)
  })

  // Synchronize calendar grid month page whenever the end date calendar dialog opens
  useResetOnChange([endCalOpen, endVal], () => {
    if (endCalOpen) {
      setEndCalMonth(parseDateString(endVal) ?? startOfToday())
    }
  })

  const hintText =
    hasSched && hasTrk
      ? 'Both Schedule and Track Completion are on. Choose a schedule pattern, or "After completion" to repeat when you check this done.'
      : hasTrk && !hasSched
      ? '"After completion" repeats whenever you mark this done.'
      : 'Choose how often this scheduled item repeats.'

  function handleSet() {
    const finalIntervalNum = Math.max(1, intervalNum)
    const finalCompletionNum = Math.max(1, completionNum)
    onConfirm(buildRepeat(freq, wdays, monthly, endType, endVal, serialiseInterval(finalCompletionNum, completionUnit), finalIntervalNum, scheduled?.date))
    onClose()
  }

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalTitle>Repeat</ResponsiveModalTitle>
        <ResponsiveModalDescription>
          Configure repeat patterns for this entry
        </ResponsiveModalDescription>

        <div className="px-4 pt-4 pb-4 flex flex-col gap-4">
          {/* Hint */}
          <div className="flex gap-2 items-start bg-accent/40 rounded-lg p-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{hintText}</span>
          </div>

          {/* Topmost Dropdown for Repeat Type */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground">Repeat Type</div>
            <Select
              disabled={!hasSched || !hasTrk}
              value={freq === 'after_completion' ? 'after_completion' : 'schedule'}
              onValueChange={(val) => {
                if (val === 'after_completion') {
                  setFreq('after_completion')
                } else {
                  // Switch to schedule, defaulting to computed frequency or weekly
                  const s = initState(repeat, scheduled, hasSched, hasTrk)
                  setFreq(s.freq === 'after_completion' ? 'weekly' : s.freq)
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="schedule">Calendar Schedule</SelectItem>
                <SelectItem value="after_completion">After Completion</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Conditional Sections */}
          {freq !== 'after_completion' ? (
            <div className="flex flex-col gap-4">
              {/* Repeats every row */}
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground">Repeats every</div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    className="w-20"
                    value={intervalNum === 0 ? '' : intervalNum}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setIntervalNum(0);
                      } else {
                        setIntervalNum(Math.max(1, parseInt(val, 10) || 1));
                      }
                    }}
                  />
                  <Select value={freq} onValueChange={(v) => setFreq(v as Freq)}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">days</SelectItem>
                      <SelectItem value="weekly">weeks</SelectItem>
                      <SelectItem value="monthly">months</SelectItem>
                      <SelectItem value="yearly">years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Weekly: day-of-week picker */}
              {freq === 'weekly' && (
                <ToggleGroup
                  type="multiple"
                  value={wdays.reduce<string[]>((acc, on, i) => on ? [...acc, String(i)] : acc, [])}
                  onValueChange={(vals) => {
                    const next = [false, false, false, false, false, false, false]
                    vals.forEach(v => { next[parseInt(v)] = true })
                    setWdays(next)
                  }}
                  className="my-1"
                >
                  {wdayDisplayOrder.map((i) => (
                    <ToggleGroupItem
                      key={WDAY_LABELS[i]}
                      value={String(i)}
                      className={cn(badgeVariants({ variant: 'chip' }), 'flex-1 justify-center')}
                    >
                      {WDAY_LABELS[i]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}

              {/* Monthly: pattern picker (Inferred Same-day and Inferred Weekday options) */}
              {freq === 'monthly' && (
                <div className="flex flex-col gap-1.5 my-1">
                  {(() => {
                    const d = parseDateString(scheduled?.date ?? '')
                    const options: { id: MonthlyMode; label: string }[] = []
                    if (d) {
                      const mday = d.getDate()
                      const mdayStr = getOrdinalSuffix(mday)
                      options.push({ id: 'same-day', label: `Every ${mdayStr} of the month` })
                      
                      const spec = monthlyWeekdaySpec(d)
                      options.push({ id: 'weekday-pattern', label: spec.label })
                    } else {
                      options.push({ id: 'same-day', label: 'Same day of month' })
                      options.push({ id: 'weekday-pattern', label: 'First weekday of month' })
                    }
                    
                    return options.map(o => (
                      <button
                        key={o.id}
                        onClick={() => setMonthly(o.id)}
                        className={cn(
                          "px-3 py-2.5 rounded-lg border text-xs text-left transition-all cursor-pointer",
                          monthly === o.id
                            ? "bg-primary/10 border-primary text-primary font-semibold"
                            : "bg-secondary border-border/50 text-muted-foreground hover:bg-secondary/80"
                        )}
                      >
                        {o.label}
                      </button>
                    ))
                  })()}
                </div>
              )}

              {/* End section */}
              <div className="pt-3 border-t border-border/50">
                <div className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground mb-2">Ends</div>
                <ToggleGroup
                  type="single"
                  value={endType}
                  onValueChange={(v) => { if (v) setEndType(v as EndType) }}
                  className="justify-start gap-2 mb-2.5"
                >
                  {(['never', 'until', 'count'] as EndType[]).map(t => (
                    <ToggleGroupItem
                      key={t}
                      value={t}
                      className={badgeVariants({ variant: 'chip' })}
                    >
                      {t === 'never' ? 'Never' : t === 'until' ? 'On date' : 'After N'}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                {endType === 'until' && (
                  <button
                    onClick={() => setEndCalOpen(true)}
                    className="w-full flex items-center justify-between bg-secondary border border-border/50 hover:bg-secondary/80 focus:border-primary focus:outline-none rounded-lg px-3 py-2 text-xs font-semibold text-primary transition-colors cursor-pointer"
                  >
                    <span>On date</span>
                    <span className="font-mono text-muted-foreground">
                      {endVal ? endVal.replace(/-/g, '/') : 'Select date'}
                    </span>
                  </button>
                )}
                {endType === 'count' && (
                  <Input
                    type="number"
                    placeholder="occurrences"
                    value={endVal}
                    onChange={e => setEndVal(e.target.value)}
                  />
                )}
              </div>
            </div>
          ) : (
            /* After completion sub-form (inline number and unit select) */
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground">Repeats every</div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  className="w-20"
                  value={completionNum === 0 ? '' : completionNum}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setCompletionNum(0);
                    } else {
                      setCompletionNum(Math.max(1, parseInt(val, 10) || 1));
                    }
                  }}
                />
                <Select value={completionUnit} onValueChange={setCompletionUnit}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="days">{completionNum === 1 ? 'day' : 'days'}</SelectItem>
                    <SelectItem value="weeks">{completionNum === 1 ? 'week' : 'weeks'}</SelectItem>
                    <SelectItem value="months">{completionNum === 1 ? 'month' : 'months'}</SelectItem>
                    <SelectItem value="years">{completionNum === 1 ? 'year' : 'years'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <ResponsiveModalActions
          onRemove={() => { onRemove(); onClose() }}
          onCancel={onClose}
          onSet={handleSet}
        />

        {/* Nested Calendar Dialog for End Date selection — forced to Dialog to avoid
            stacking a second drawer on top of RepeatDialog's own mobile drawer. */}
        <ResponsiveModal open={endCalOpen} onOpenChange={(o) => !o && setEndCalOpen(false)} forceDialog>
          <ResponsiveModalContent className="sm:max-w-xs">
            <ResponsiveModalTitle>End Date</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Select the end date for this recurrence
            </ResponsiveModalDescription>

            <div className="flex flex-col gap-4 items-center px-4 pt-4 pb-4">
              <Calendar
                mode="single"
                fixedWeeks
                weekStartsOn={weekStartsOn(localePrefs)}
                selected={parseDateString(endVal) ?? undefined}
                onSelect={(date) => {
                  if (date) {
                    setEndVal(fmtISO(date))
                  }
                  setEndCalOpen(false)
                }}
                month={endCalMonth}
                onMonthChange={setEndCalMonth}
                className="w-full [--cell-size:2.25rem] p-0"
              />

              {/* Shortcut toggles */}
              <div className="flex gap-2 w-full">
                {(() => {
                  const today = startOfToday()
                  const tomorrow = new Date(today)
                  tomorrow.setDate(today.getDate() + 1)

                  const isToday = endVal === fmtISO(today)
                  const isTomorrow = endVal === fmtISO(tomorrow)

                  return (
                    <>
                      <Button
                        variant={isToday ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => {
                          setEndVal(fmtISO(today))
                          setEndCalMonth(today)
                        }}
                      >
                        Today
                      </Button>
                      <Button
                        variant={isTomorrow ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => {
                          setEndVal(fmtISO(tomorrow))
                          setEndCalMonth(tomorrow)
                        }}
                      >
                        Tomorrow
                      </Button>
                    </>
                  )
                })()}
              </div>
            </div>

            <Separator />
            <div className="flex justify-end gap-2 px-4 pt-4 pb-4">
              <Button variant="outline" size="sm" onClick={() => setEndCalOpen(false)}>
                Close
              </Button>
            </div>
          </ResponsiveModalContent>
        </ResponsiveModal>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
