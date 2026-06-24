import React from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { ScrollColumn } from './ScrollColumn'

const HOURS:   number[] = Array.from({ length: 24 }, (_, i) => i)
const MINUTES: number[] = Array.from({ length: 12 }, (_, i) => i * 5)

interface Props {
  hour: number
  minute: number
  onHourChange: (h: number) => void
  onMinuteChange: (m: number) => void
}

export function TimeWheels({ hour, minute, onHourChange, onMinuteChange }: Props) {
  const isTouch = useMediaQuery('(pointer: coarse)')
  const sep = <span className="text-2xl font-mono text-muted-foreground select-none pb-0.5">:</span>

  if (isTouch) {
    return (
      <div className="flex items-center justify-center gap-1">
        <ScrollColumn items={HOURS}   value={hour}   onChange={onHourChange}   format={(h) => String(h).padStart(2, '0')} className="w-16" />
        {sep}
        <ScrollColumn items={MINUTES} value={minute} onChange={onMinuteChange} format={(m) => String(m).padStart(2, '0')} className="w-16" />
      </div>
    )
  }

  const timeValue = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  function handleTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const parts = e.target.value.split(':')
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    if (!isNaN(h)) onHourChange(h)
    if (!isNaN(m)) onMinuteChange(m)
  }

  return (
    <div className="flex items-center justify-center px-4">
      <input
        type="time"
        value={timeValue}
        onChange={handleTimeChange}
        className="bg-background border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-sm font-mono text-foreground transition-colors appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
      />
    </div>
  )
}
