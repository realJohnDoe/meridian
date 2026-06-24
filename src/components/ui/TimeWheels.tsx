import { useMediaQuery } from '@/hooks/use-media-query'
import { ScrollColumn } from './ScrollColumn'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

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

  return (
    <div className="flex items-center justify-center gap-2">
      <Select value={String(hour)} onValueChange={(v) => onHourChange(parseInt(v, 10))}>
        <SelectTrigger className="w-20 font-mono">
          <SelectValue>{String(hour).padStart(2, '0')}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-52">
          {HOURS.map(h => (
            <SelectItem key={h} value={String(h)} className="font-mono">{String(h).padStart(2, '0')}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {sep}
      <Select value={String(minute)} onValueChange={(v) => onMinuteChange(parseInt(v, 10))}>
        <SelectTrigger className="w-20 font-mono">
          <SelectValue>{String(minute).padStart(2, '0')}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-52">
          {MINUTES.map(m => (
            <SelectItem key={m} value={String(m)} className="font-mono">{String(m).padStart(2, '0')}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
