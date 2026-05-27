import { useState, useEffect } from 'react'
import { Info, X } from 'lucide-react'
import type { Repeat, Scheduled, Weekday } from '../types'
import { parseDateString } from '../model/expand'

// ── Types ─────────────────────────────────────────────────────────────────────

type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'after_completion'
type EndType = 'never' | 'until' | 'count'
type MonthlyMode = 'first-weekday' | 'last-weekday' | 'same-day'

interface DialogState {
  freq: Freq
  wdays: boolean[]         // Mon–Sun, index 0–6
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

// ── Constants ─────────────────────────────────────────────────────────────────

const WDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const WDAY_CODES: Weekday[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']

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
      monthly: 'first-weekday',
      endType: 'never',
      endVal: '',
      interval: '1 day',
    }
  }

  if (repeat.type === 'after_completion') {
    return {
      freq: 'after_completion',
      wdays: defaultWdays(scheduled?.date),
      monthly: 'first-weekday',
      endType: 'never',
      endVal: '',
      interval: repeat.interval ?? '1 day',
    }
  }

  // Scheduled repeat: reverse-engineer state from the flat spec
  const s = repeat

  // Determine monthly mode
  let monthly: MonthlyMode = 'same-day'
  if (s.byweekday && s.bysetpos === 1)  monthly = 'first-weekday'
  if (s.byweekday && s.bysetpos === -1) monthly = 'last-weekday'

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
): Repeat {
  if (freq === 'after_completion') {
    return { type: 'after_completion', interval }
  }

  const r: Repeat = { type: 'schedule', freq: freq as Exclude<Repeat, { type: 'after_completion' }>['freq'] }

  if (freq === 'weekly') {
    r.byweekday = WDAY_CODES.filter((_, i) => wdays[i])
  }

  if (freq === 'monthly') {
    if (monthly === 'first-weekday') {
      r.byweekday = ['mo', 'tu', 'we', 'th', 'fr']
      r.bysetpos = 1
    } else if (monthly === 'last-weekday') {
      r.byweekday = ['mo', 'tu', 'we', 'th', 'fr']
      r.bysetpos = -1
    }
    // 'same-day': no byweekday, recurrence engine uses the root date's day
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

  const [freq,     setFreq]     = useState<Freq>('weekly')
  const [wdays,    setWdays]    = useState<boolean[]>([false, false, false, false, false, false, false])
  const [monthly,  setMonthly]  = useState<MonthlyMode>('first-weekday')
  const [endType,  setEndType]  = useState<EndType>('never')
  const [endVal,   setEndVal]   = useState('')
  const [interval, setInterval] = useState('1 day')

  // Re-initialise whenever the dialog opens (so stale state never leaks between opens)
  useEffect(() => {
    if (!open) return
    const s = initState(repeat, scheduled, hasSched, hasTrk)
    setFreq(s.freq)
    setWdays(s.wdays)
    setMonthly(s.monthly)
    setEndType(s.endType)
    setEndVal(s.endVal)
    setInterval(s.interval)
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

  function handleConfirm() {
    onConfirm(buildRepeat(freq, wdays, monthly, endType, endVal, interval))
  }

  return (
    <div
      className={`dlg-ov${open ? ' open' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="dlg">
        <div className="dlg-handle" />
        <div className="dlg-title">Repeat</div>
        <div className="dlg-body">

          {/* Hint */}
          <div className="dlg-hint">
            <Info size={13} />
            <span>{hintText}</span>
          </div>

          {/* Frequency grid */}
          <div className="recur-grid">
            {freqOpts.map(o => (
              <button
                key={o.id}
                className={`ro${freq === o.id ? ' on' : ''}`}
                onClick={() => setFreq(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Weekly: day-of-week picker */}
          {freq === 'weekly' && (
            <div className="wd-row">
              {WDAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  className={`wd${wdays[i] ? ' on' : ''}`}
                  onClick={() => toggleWday(i)}
                >
                  {d}
                </button>
              ))}
            </div>
          )}

          {/* Monthly: pattern picker */}
          {freq === 'monthly' && (
            <div className="monthly-opts">
              {([
                ['first-weekday', 'First weekday of month'],
                ['last-weekday',  'Last weekday of month' ],
                ['same-day',      'Same day of month'     ],
              ] as [MonthlyMode, string][]).map(([v, label]) => (
                <button
                  key={v}
                  className={`mopt${monthly === v ? ' on' : ''}`}
                  onClick={() => setMonthly(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* After completion: interval input */}
          {freq === 'after_completion' && (
            <div className="interval-row">
              <span>Every</span>
              <input
                className="dlg-in"
                value={interval}
                onChange={e => setInterval(e.target.value)}
                style={{ width: 130 }}
                placeholder="e.g. 2 days"
              />
            </div>
          )}

          {/* End section (hidden for after_completion) */}
          {freq !== 'after_completion' && (
            <div className="end-sec">
              <div className="end-lbl">Ends</div>
              <div className="end-opts">
                {(['never', 'until', 'count'] as EndType[]).map(t => (
                  <button
                    key={t}
                    className={`eopt${endType === t ? ' on' : ''}`}
                    onClick={() => setEndType(t)}
                  >
                    {t === 'never' ? 'Never' : t === 'until' ? 'On date' : 'After N'}
                  </button>
                ))}
              </div>

              {endType === 'until' && (
                <input
                  className="dlg-in"
                  type="date"
                  value={endVal}
                  onChange={e => setEndVal(e.target.value)}
                  style={{ width: '100%', marginTop: 6 }}
                />
              )}
              {endType === 'count' && (
                <input
                  className="dlg-in"
                  type="number"
                  placeholder="occurrences"
                  value={endVal}
                  onChange={e => setEndVal(e.target.value)}
                  style={{ width: '100%', marginTop: 6 }}
                />
              )}
            </div>
          )}

          {/* Actions */}
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={onRemove}>
              <X size={13} />Remove
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="dlg-cancel" onClick={onClose}>Cancel</button>
              <button className="dlg-ok" onClick={handleConfirm}>Set</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
