import { useState, useEffect } from 'react'
import { Info, X } from 'lucide-react'
import type { Repeat, Scheduled, Weekday } from '../types'
import { parseDateString } from '../model/expand'
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from './ui/drawer'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Separator } from './ui/separator'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Calendar } from './ui/calendar'
import { cn } from '../lib/utils'

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
const WDAY_CODES_SUN_FIRST: Weekday[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']
const WDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Helpers ───────────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)   // local time, avoids UTC-offset day shift
}

function dateToIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseCompletionInterval(s: string): { n: number; unit: string } {
  if (!s) return { n: 1, unit: 'days' }
  const match = s.trim().match(/^(\d+)\s*(day|week|month|year)s?$/i)
  if (!match) return { n: 1, unit: 'days' }
  const unit = match[2].toLowerCase() + 's' // standardize to plural
  return { n: parseInt(match[1], 10), unit }
}

function serialiseCompletionInterval(n: number, unit: string): string {
  const label = n === 1 ? unit.replace(/s$/, '') : unit
  return `${n} ${label}`
}

// ── Dropdown options and calculations ─────────────────────────────────────────

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getMonthlyWeekdaySpec(jsDate: Date) {
  const jsDay = jsDate.getDay();
  const wdayCode = WDAY_CODES_SUN_FIRST[jsDay];
  const wdayLabel = WDAY_NAMES[jsDay]; // e.g. "Friday"
  
  const year = jsDate.getFullYear();
  const month = jsDate.getMonth();
  const candidates: number[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const candidate = new Date(year, month, day);
    if (candidate.getDay() === jsDay) {
      candidates.push(day);
    }
  }
  
  const index = candidates.indexOf(jsDate.getDate());
  const isLast = (index === candidates.length - 1);
  
  let bysetpos = index + 1;
  let ordinal = ['first', 'second', 'third', 'fourth', 'fifth'][index];
  
  if (isLast) {
    bysetpos = -1;
    ordinal = 'last';
  }
  
  return {
    byweekday: [wdayCode],
    bysetpos,
    label: `Every ${ordinal} ${wdayLabel} of the month`
  };
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
    freq: s.freq as Freq,
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
    freq: freq as Exclude<Repeat, { type: 'after_completion' }>['freq'],
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
        const spec = getMonthlyWeekdaySpec(d)
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
  useEffect(() => {
    if (!open) return
    const s = initState(repeat, scheduled, hasSched, hasTrk)
    setFreq(s.freq)
    setWdays(s.wdays)
    setMonthly(s.monthly)
    setEndType(s.endType)
    setEndVal(s.endVal)
    setIntervalNum(s.intervalNum)
    
    const parsed = parseCompletionInterval(s.interval)
    setCompletionNum(parsed.n)
    setCompletionUnit(parsed.unit)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronize calendar grid month page whenever the end date calendar dialog opens
  useEffect(() => {
    if (endCalOpen) {
      setEndCalMonth(isoToDate(endVal) ?? startOfToday())
    }
  }, [endCalOpen, endVal])

  const hintText =
    hasSched && hasTrk
      ? 'Both Schedule and Track Completion are on. Choose a schedule pattern, or "After completion" to repeat when you check this done.'
      : hasTrk && !hasSched
      ? '"After completion" repeats whenever you mark this done.'
      : 'Choose how often this scheduled item repeats.'

  function toggleWday(i: number) {
    setWdays(prev => { const next = [...prev]; next[i] = !next[i]; return next })
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="pt-3 pb-6">
        <DrawerTitle>Repeat</DrawerTitle>
        <DrawerDescription className="sr-only">
          Configure repeat patterns for this entry
        </DrawerDescription>
        <Separator />

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
                  <input
                    type="number"
                    min={1}
                    className="w-20 bg-secondary border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-xs font-mono text-foreground transition-colors"
                    value={intervalNum === 0 ? '' : intervalNum}
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
                <div className="flex gap-1 my-1">
                  {WDAY_LABELS.map((d, i) => (
                    <button
                      key={d}
                      onClick={() => toggleWday(i)}
                      className={cn(
                        "flex-1 py-2 rounded-lg border text-[11px] text-center transition-all cursor-pointer",
                        wdays[i]
                          ? "bg-primary/10 border-primary text-primary font-semibold"
                          : "bg-secondary border-border/50 text-muted-foreground hover:bg-secondary/80"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
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
                      
                      const spec = getMonthlyWeekdaySpec(d)
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
                <div className="flex gap-2 mb-2.5">
                  {(['never', 'until', 'count'] as EndType[]).map(t => (
                    <button
                      key={t}
                      onClick={() => setEndType(t)}
                      className={cn(
                        "px-3 py-1.5 rounded-full border text-xs transition-all cursor-pointer",
                        endType === t
                          ? "bg-primary/10 border-primary text-primary font-medium"
                          : "bg-secondary border-border/50 text-muted-foreground hover:bg-secondary/80"
                      )}
                    >
                      {t === 'never' ? 'Never' : t === 'until' ? 'On date' : 'After N'}
                    </button>
                  ))}
                </div>

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
                  <input
                    className="w-full bg-secondary border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground transition-colors"
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
                <input
                  type="number"
                  min={1}
                  className="w-20 bg-secondary border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-xs font-mono text-foreground transition-colors"
                  value={completionNum === 0 ? '' : completionNum}
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

        <Separator />

        {/* Footer: Remove on left, Cancel + Set on right */}
        <DrawerFooter>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive gap-1.5"
            onClick={() => { onRemove(); onClose() }}
          >
            <X className="h-3.5 w-3.5" />
            Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => {
                const finalIntervalNum = Math.max(1, intervalNum);
                const finalCompletionNum = Math.max(1, completionNum);
                onConfirm(buildRepeat(freq, wdays, monthly, endType, endVal, serialiseCompletionInterval(finalCompletionNum, completionUnit), finalIntervalNum, scheduled?.date));
                onClose();
              }}>
              Set
            </Button>
          </div>
        </DrawerFooter>

        {/* Nested Calendar Dialog for End Date selection */}
        <Dialog open={endCalOpen} onOpenChange={(o) => !o && setEndCalOpen(false)}>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-xs p-5">
            <DialogHeader>
              <DialogTitle>End Date</DialogTitle>
              <DialogDescription className="sr-only">
                Select the end date for this recurrence
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 items-center pt-2">
              <Calendar
                mode="single"
                fixedWeeks
                selected={isoToDate(endVal)}
                onSelect={(date) => {
                  if (date) {
                    setEndVal(dateToIso(date))
                  }
                  setEndCalOpen(false)
                }}
                month={endCalMonth}
                onMonthChange={setEndCalMonth}
                className="w-full [--cell-size:2.25rem] p-0"
              />

              {/* Shortcut toggles */}
              <div className="flex gap-2 w-full mt-2">
                {(() => {
                  const today = startOfToday()
                  const tomorrow = new Date(today)
                  tomorrow.setDate(today.getDate() + 1)
                  
                  const isToday = endVal === dateToIso(today)
                  const isTomorrow = endVal === dateToIso(tomorrow)
                  
                  return (
                    <>
                      <Button
                        variant={isToday ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => {
                          setEndVal(dateToIso(today))
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
                          setEndVal(dateToIso(tomorrow))
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

            <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
              <Button variant="outline" size="sm" onClick={() => setEndCalOpen(false)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DrawerContent>
    </Drawer>
  )
}
