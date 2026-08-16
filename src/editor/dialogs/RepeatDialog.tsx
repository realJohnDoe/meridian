import { useReducer, useState } from 'react'
import { Info } from 'lucide-react'
import type { Repeat, Scheduled } from '@/types'
import type { RepeatForm, RepeatFormContext, RepeatFormFreq, ScheduleFreq, MonthlyMode, RepeatEndType, DurationUnit } from '@/model'
import { parseDateString, weekStartsOn, monthlyWeekdaySpec, repeatToForm, formToRepeat } from '@/model'
import { useStore } from '@/store'
import { useResetOnChange } from '@/hooks'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
} from '@/components/primitives/responsive-modal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { badgeVariants } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { NumberUnitInput } from './NumberUnitInput'
import DatePickerDialog from './DatePickerDialog'

// ── Types ─────────────────────────────────────────────────────────────────────

// The editable shape and its Repeat ⇄ form conversions live in `model/repeat.ts`
// — this dialog only renders them. Note the conversions are deliberately lossy;
// the contract comment there spells out which values don't survive a round trip.

type DialogAction =
  | { type: 'reset'; state: RepeatForm }
  | { type: 'set'; patch: Partial<RepeatForm> }

function dialogReducer(state: RepeatForm, action: DialogAction): RepeatForm {
  switch (action.type) {
    case 'reset': return action.state
    case 'set': return { ...state, ...action.patch }
  }
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

// Display labels for `RepeatForm.wdays` — same Monday-first index order.
const WDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const FREQ_UNITS: readonly ScheduleFreq[] = ['daily', 'weekly', 'monthly', 'yearly']
const FREQ_UNIT_LABELS: Record<ScheduleFreq, string> = {
  daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years',
}

const COMPLETION_UNITS: readonly DurationUnit[] = ['days', 'weeks', 'months', 'years']
function completionUnitLabel(unit: DurationUnit, n: number): string {
  return n === 1 ? unit.replace(/s$/, '') : unit
}

// ── Dropdown options and calculations ─────────────────────────────────────────

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
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
  const formCtx: RepeatFormContext = { scheduledDate: scheduled?.date, hasSchedule: hasSched, hasTracking: hasTrk }

  const [state, dispatch] = useReducer(
    dialogReducer,
    { repeat, formCtx },
    ({ repeat, formCtx }) => repeatToForm(repeat, formCtx),
  )
  const { freq, wdays, monthly, endType, endVal, intervalNum, completionNum, completionUnit } = state
  const setFreq           = (freq: RepeatFormFreq) => dispatch({ type: 'set', patch: { freq } })
  const setWdays          = (wdays: boolean[])    => dispatch({ type: 'set', patch: { wdays } })
  const setMonthly        = (monthly: MonthlyMode)=> dispatch({ type: 'set', patch: { monthly } })
  const setEndType        = (endType: RepeatEndType) => dispatch({ type: 'set', patch: { endType } })
  const setEndVal         = (endVal: string)      => dispatch({ type: 'set', patch: { endVal } })
  const setIntervalNum    = (intervalNum: number) => dispatch({ type: 'set', patch: { intervalNum } })
  const setCompletionNum  = (completionNum: number) => dispatch({ type: 'set', patch: { completionNum } })
  const setCompletionUnit = (completionUnit: DurationUnit) => dispatch({ type: 'set', patch: { completionUnit } })

  const [endCalOpen, setEndCalOpen] = useState(false)

  // Re-initialise whenever the dialog opens (so stale state never leaks between opens)
  useResetOnChange([open], () => {
    if (!open) return
    dispatch({ type: 'reset', state: repeatToForm(repeat, formCtx) })
  })

  const hintText =
    hasSched && hasTrk
      ? 'Both Schedule and Track Completion are on. Choose a schedule pattern, or "After completion" to repeat when you check this done.'
      : hasTrk && !hasSched
      ? '"After completion" repeats whenever you mark this done.'
      : 'Choose how often this scheduled item repeats.'

  function handleSet() {
    onConfirm(formToRepeat(state, scheduled?.date))
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
            <div className="text-2xs font-bold tracking-wider uppercase text-muted-foreground">Repeat Type</div>
            <Select
              disabled={!hasSched || !hasTrk}
              value={freq === 'after_completion' ? 'after_completion' : 'schedule'}
              onValueChange={(val) => {
                if (val === 'after_completion') {
                  setFreq('after_completion')
                } else {
                  // Switch to schedule, defaulting to computed frequency or weekly
                  const { freq } = repeatToForm(repeat, formCtx)
                  setFreq(freq === 'after_completion' ? 'weekly' : freq)
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
                <div className="text-2xs font-bold tracking-wider uppercase text-muted-foreground">Repeats every</div>
                <NumberUnitInput
                  n={intervalNum}
                  onNChange={setIntervalNum}
                  unit={freq}
                  units={FREQ_UNITS}
                  onUnitChange={setFreq}
                  unitLabel={(u) => FREQ_UNIT_LABELS[u]}
                />
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
                <div className="text-2xs font-bold tracking-wider uppercase text-muted-foreground mb-2">Ends</div>
                <ToggleGroup
                  type="single"
                  value={endType}
                  onValueChange={(v) => { if (v) setEndType(v as RepeatEndType) }}
                  className="justify-start gap-2 mb-2.5"
                >
                  {(['never', 'until', 'count'] as RepeatEndType[]).map(t => (
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
              <div className="text-2xs font-bold tracking-wider uppercase text-muted-foreground">Repeats every</div>
              <NumberUnitInput
                n={completionNum}
                onNChange={setCompletionNum}
                unit={completionUnit}
                units={COMPLETION_UNITS}
                onUnitChange={setCompletionUnit}
                unitLabel={completionUnitLabel}
              />
            </div>
          )}
        </div>

        <ResponsiveModalActions
          onRemove={() => { onRemove(); onClose() }}
          onCancel={onClose}
          onSet={handleSet}
        />

        {/* Forced to Dialog to avoid stacking a second drawer on top of
            RepeatDialog's own mobile drawer. */}
        <DatePickerDialog
          open={endCalOpen}
          initialDate={endVal}
          onConfirm={setEndVal}
          onRemove={() => setEndVal('')}
          onClose={() => setEndCalOpen(false)}
          forceDialog
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
