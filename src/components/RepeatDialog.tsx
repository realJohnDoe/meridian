import { useState, useEffect } from 'react'
import { Info, X } from 'lucide-react'
import type { Repeat, Scheduled, ScheduledRepeat, Weekday } from '../types'
import { parseDateString } from '../recurrence'
import { cn } from '../lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'after_completion'
type EndType = 'never' | 'until' | 'count'
type MonthlyMode = 'first-weekday' | 'last-weekday' | 'same-day'

interface DialogState {
  freq: Freq
  wdays: boolean[]
  monthly: MonthlyMode
  endType: EndType
  endVal: string
  interval: string
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

const WDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const WDAY_CODES: Weekday[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']

function defaultWdays(scheduledDate?: string | null): boolean[] {
  const wdays = [false, false, false, false, false, false, false]
  const jsDay = parseDateString(scheduledDate ?? '') ?.getDay() ?? 1
  const monFirst = (jsDay + 6) % 7
  wdays[monFirst] = true
  return wdays
}

function initState(
  repeat: Repeat | null,
  scheduled: Scheduled | null,
  hasSched: boolean,
  hasTrk: boolean,
): DialogState {
  const defaultFreq: Freq = hasTrk && !hasSched ? 'after_completion' : 'weekly'

  if (!repeat) {
    return { freq: defaultFreq, wdays: defaultWdays(scheduled?.date), monthly: 'first-weekday', endType: 'never', endVal: '', interval: '1 day' }
  }

  if (repeat.type === 'after_completion') {
    return { freq: 'after_completion', wdays: defaultWdays(scheduled?.date), monthly: 'first-weekday', endType: 'never', endVal: '', interval: repeat.interval ?? '1 day' }
  }

  const s = repeat.scheduled
  let monthly: MonthlyMode = 'same-day'
  if (s.byweekday && s.bysetpos === 1)  monthly = 'first-weekday'
  if (s.byweekday && s.bysetpos === -1) monthly = 'last-weekday'

  const wdays = [false, false, false, false, false, false, false]
  if (s.freq === 'weekly' && s.byweekday) {
    WDAY_CODES.forEach((code, i) => { wdays[i] = (s.byweekday ?? []).includes(code) })
  }

  let endType: EndType = 'never'
  let endVal = ''
  if (s.end?.type === 'until') { endType = 'until'; endVal = s.end.date ?? s.end.time ?? '' }
  else if (s.end?.type === 'count') { endType = 'count'; endVal = String(s.end.occurrences) }

  return { freq: s.freq as Freq, wdays, monthly, endType, endVal, interval: '1 day' }
}

function buildRepeat(freq: Freq, wdays: boolean[], monthly: MonthlyMode, endType: EndType, endVal: string, interval: string): Repeat {
  if (freq === 'after_completion') return { type: 'after_completion', interval }

  const s: ScheduledRepeat = { freq: freq as ScheduledRepeat['freq'] }

  if (freq === 'weekly') s.byweekday = WDAY_CODES.filter((_, i) => wdays[i])

  if (freq === 'monthly') {
    if (monthly === 'first-weekday') { s.byweekday = ['mo', 'tu', 'we', 'th', 'fr']; s.bysetpos = 1 }
    else if (monthly === 'last-weekday') { s.byweekday = ['mo', 'tu', 'we', 'th', 'fr']; s.bysetpos = -1 }
  }

  if (endType === 'until' && endVal) s.end = { type: 'until', date: endVal }
  if (endType === 'count' && endVal) s.end = { type: 'count', occurrences: parseInt(endVal, 10) }

  return { type: 'schedule', scheduled: s }
}

// ── Shared class strings ───────────────────────────────────────────────────────

const dlgOverlayCls = (open: boolean) => cn(
  'fixed inset-0 bg-[rgba(9,17,31,.82)] z-[200] flex items-end justify-center transition-opacity duration-200',
  open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
)
const dlgPanelCls = (open: boolean) => cn(
  'w-full max-w-[430px] bg-bg2 border-t border-bdr2 rounded-t-[24px] pt-3 pb-10',
  'transition-[transform] duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)]',
  open ? 'translate-y-0' : 'translate-y-full',
)

// ── Component ─────────────────────────────────────────────────────────────────

export default function RepeatDialog({ open, scheduled, tracked, itemType, repeat, onConfirm, onRemove, onClose }: Props) {
  const hasSched = !!scheduled
  const hasTrk   = tracked && itemType !== 'event'

  const [freq,     setFreq]     = useState<Freq>('weekly')
  const [wdays,    setWdays]    = useState<boolean[]>([false, false, false, false, false, false, false])
  const [monthly,  setMonthly]  = useState<MonthlyMode>('first-weekday')
  const [endType,  setEndType]  = useState<EndType>('never')
  const [endVal,   setEndVal]   = useState('')
  const [interval, setInterval] = useState('1 day')

  useEffect(() => {
    if (!open) return
    const s = initState(repeat, scheduled, hasSched, hasTrk)
    setFreq(s.freq); setWdays(s.wdays); setMonthly(s.monthly)
    setEndType(s.endType); setEndVal(s.endVal); setInterval(s.interval)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const hintText =
    hasSched && hasTrk
      ? 'Both Schedule and Track Completion are on. Choose a schedule pattern, or "After completion" to repeat when you check this done.'
      : hasTrk && !hasSched
      ? '"After completion" repeats whenever you mark this done.'
      : 'Choose how often this scheduled item repeats.'

  const freqOpts: { id: Freq; label: string }[] = [
    ...(hasSched ? [
      { id: 'daily'   as Freq, label: 'Daily'   },
      { id: 'weekly'  as Freq, label: 'Weekly'  },
      { id: 'monthly' as Freq, label: 'Monthly' },
      { id: 'yearly'  as Freq, label: 'Yearly'  },
    ] : []),
    ...(hasTrk ? [{ id: 'after_completion' as Freq, label: 'After ✓' }] : []),
  ]

  function toggleWday(i: number) {
    setWdays(prev => { const next = [...prev]; next[i] = !next[i]; return next })
  }

  // Shared input class
  const inputCls = 'bg-bg3 border border-transparent rounded-[8px] px-[11px] py-[7px] text-[13px] font-mono text-t0 outline-none transition-colors focus:border-ind placeholder:text-t3'

  return (
    <div className={dlgOverlayCls(open)} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={dlgPanelCls(open)}>

        {/* Handle + title */}
        <div className="w-[34px] h-1 bg-bg4 rounded-[2px] mx-auto mb-3.5" />
        <div className="text-[13px] font-bold tracking-[.07em] uppercase text-t3 px-[18px] pb-[10px] border-b border-bdr mb-2">
          Repeat
        </div>

        <div className="px-4">

          {/* Hint */}
          <div className="text-[11px] text-t3 mb-[10px] leading-[1.5] bg-bg3 rounded-[8px] p-3 flex gap-[7px] items-start">
            <Info size={13} className="stroke-ind fill-none shrink-0 mt-px" strokeWidth={2} />
            <span>{hintText}</span>
          </div>

          {/* Frequency grid */}
          <div className="grid grid-cols-3 gap-1.5 mb-[10px]">
            {freqOpts.map(o => (
              <button
                key={o.id}
                className={cn(
                  'py-2 px-1 rounded-[8px] border text-[12px] text-center cursor-pointer transition-all duration-[120ms]',
                  freq === o.id ? 'bg-ab2 border-ind text-ind' : 'bg-bg3 border-bdr2 text-t2',
                )}
                onClick={() => setFreq(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Weekly: day-of-week picker */}
          {freq === 'weekly' && (
            <div className="flex gap-1 my-2">
              {WDAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  className={cn(
                    'flex-1 py-[7px] rounded-[7px] border text-[11px] text-center cursor-pointer transition-all duration-[120ms]',
                    wdays[i] ? 'bg-ab2 border-ind text-ind font-semibold' : 'bg-bg3 border-bdr2 text-t2',
                  )}
                  onClick={() => toggleWday(i)}
                >
                  {d}
                </button>
              ))}
            </div>
          )}

          {/* Monthly: pattern picker */}
          {freq === 'monthly' && (
            <div className="flex flex-col gap-[5px] my-2">
              {([
                ['first-weekday', 'First weekday of month'],
                ['last-weekday',  'Last weekday of month' ],
                ['same-day',      'Same day of month'     ],
              ] as [MonthlyMode, string][]).map(([v, label]) => (
                <button
                  key={v}
                  className={cn(
                    'py-[9px] px-3 rounded-[8px] border text-[12px] cursor-pointer text-left transition-all duration-[120ms]',
                    monthly === v ? 'bg-ab2 border-ind text-ind' : 'bg-bg3 border-bdr2 text-t2',
                  )}
                  onClick={() => setMonthly(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* After completion: interval input */}
          {freq === 'after_completion' && (
            <div className="flex items-center gap-2 my-2">
              <span className="text-[12px] text-t2">Every</span>
              <input
                className={inputCls}
                value={interval}
                onChange={e => setInterval(e.target.value)}
                style={{ width: 130 }}
                placeholder="e.g. 2 days"
              />
            </div>
          )}

          {/* End section */}
          {freq !== 'after_completion' && (
            <div className="mt-[10px] pt-[10px] border-t border-bdr">
              <div className="text-[11px] font-bold tracking-[.06em] uppercase text-t3 mb-[7px]">Ends</div>
              <div className="flex gap-1.5 mb-2">
                {(['never', 'until', 'count'] as EndType[]).map(t => (
                  <button
                    key={t}
                    className={cn(
                      'px-3 py-[5px] rounded-[20px] text-[12px] border cursor-pointer transition-all duration-[120ms]',
                      endType === t ? 'bg-ab2 border-ind text-ind' : 'bg-bg3 border-bdr2 text-t2',
                    )}
                    onClick={() => setEndType(t)}
                  >
                    {t === 'never' ? 'Never' : t === 'until' ? 'On date' : 'After N'}
                  </button>
                ))}
              </div>

              {endType === 'until' && (
                <input className={inputCls} type="date" value={endVal} onChange={e => setEndVal(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
              )}
              {endType === 'count' && (
                <input className={inputCls} type="number" placeholder="occurrences" value={endVal} onChange={e => setEndVal(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center mt-4 pt-3 border-t border-bdr">
            <button className="text-[12px] text-ros px-3 py-2 rounded-[20px] flex items-center gap-1" onClick={onRemove}>
              <X size={13} />Remove
            </button>
            <div className="flex gap-2">
              <button className="text-[13px] text-t3 px-3.5 py-2 rounded-[20px]" onClick={onClose}>Cancel</button>
              <button
                className="text-[13px] font-semibold text-white bg-gradient-to-br from-ind2 to-cyn2 px-5 py-2 rounded-[20px]"
                onClick={() => onConfirm(buildRepeat(freq, wdays, monthly, endType, endVal, interval))}
              >
                Set
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
