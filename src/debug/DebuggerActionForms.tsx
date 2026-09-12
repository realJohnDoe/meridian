import { useState } from 'react'
import type { Occurrence } from '@/types'
import { dayBefore } from '@/model'
import { cn } from '@/lib/cn'

// ── Action button ─────────────────────────────────────────────────────────────

export function ActionBtn({
  label, icon, active = false, disabled = false, title, onClick,
}: {
  label: string; icon: React.ReactNode; active?: boolean
  disabled?: boolean; title?: string; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-2xs transition-colors',
        disabled
          ? 'text-white/15 cursor-not-allowed'
          : active
          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
          : 'text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ── Action forms ──────────────────────────────────────────────────────────────

const inputCls = 'bg-white/5 border border-white/10 rounded px-2 py-1 text-2xs font-mono text-white/70 focus:outline-none focus:border-white/30'
const btnApply = 'px-3 py-1 text-xs rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors disabled:opacity-40'
const btnCancel = 'px-3 py-1 text-xs rounded bg-white/5 text-white/40 hover:bg-white/10 transition-colors'

export function AddOccurrenceForm({ onApply, onCancel }: {
  onApply: (date: string, time: string, done: boolean) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [done, setDone] = useState(false)
  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-2xs text-white/30 w-8">date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        <label className="text-2xs text-white/30">time</label>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} className={cn(inputCls, 'w-28')} />
        <label className="text-2xs text-white/30">done</label>
        <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} className="accent-emerald-500" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => date && onApply(date, time, done)} disabled={!date} className={btnApply}>Add</button>
        <button type="button" onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}

export function EditOccurrenceForm({ occ, onApply, onCancel }: {
  occ: Occurrence
  onApply: (date: string, time: string, done: boolean) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(occ.date)
  const [time, setTime] = useState(occ.time ?? '')
  const [done, setDone] = useState(occ.metadata.done ?? false)
  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-2xs text-white/30 w-8">date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        <label className="text-2xs text-white/30">time</label>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} className={cn(inputCls, 'w-28')} />
        <label className="text-2xs text-white/30">done</label>
        <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} className="accent-emerald-500" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onApply(date, time, done)} className={btnApply}>Apply</button>
        <button type="button" onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}

export function EditFollowingForm({ occ, onApply, onCancel }: {
  occ: Occurrence
  onApply: () => void
  onCancel: () => void
}) {
  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <p className="text-2xs text-white/50 leading-relaxed">
        The current series ends on <span className="font-mono text-white/70">{dayBefore(occ.date)}</span>.
        A new series starts at <span className="font-mono text-white/70">{occ.date}</span> with the same
        pattern — use <span className="text-white/60">Edit pattern</span> afterwards to change it.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onApply}
          className="px-3 py-1 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors">
          Split series
        </button>
        <button type="button" onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}

export function DeleteConfirmForm({ message, label, onApply, onCancel }: {
  message: string; label: string; onApply: () => void; onCancel: () => void
}) {
  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <p className="text-2xs text-white/50 leading-relaxed">{message}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onApply}
          className="px-3 py-1 text-xs rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors">
          {label}
        </button>
        <button type="button" onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}
