import { useState, useEffect } from 'react'
import { useMediaQuery } from '@/hooks'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
} from '@/components/ui/responsive-modal'
import TimeWheels from '@/components/ui/TimeWheels'

function normaliseTime(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return '09:00'
  return `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2].slice(0, 2)}`
}

interface Props {
  open: boolean
  value: string
  onConfirm: (hhmm: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function TimePickerDialog({ open, value, onConfirm, onRemove, onClose }: Props) {
  const [time, setTime] = useState('09:00')
  const isTouch = useMediaQuery('(pointer: coarse)')

  useEffect(() => {
    if (open) setTime(normaliseTime(value || '09:00'))
  }, [open, value])

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveModalContent className="sm:max-w-xs">
        <ResponsiveModalTitle>Time</ResponsiveModalTitle>
        <ResponsiveModalDescription>Select a time</ResponsiveModalDescription>

        <div className="px-4 pt-4 pb-4">
          {isTouch ? (
            <div className="flex justify-center">
              <TimeWheels value={time} onChange={setTime} />
            </div>
          ) : (
            <input
              type="time"
              step={300}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full bg-background border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-sm font-mono text-foreground transition-colors appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
          )}
        </div>

        <ResponsiveModalActions
          onRemove={() => { onRemove(); onClose() }}
          onCancel={onClose}
          onSet={() => { onConfirm(time); onClose() }}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
