import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TimeWheels } from '@/components/ui/TimeWheels'

function parseTime(hhmm: string): { h: number; m: number } {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return { h: 9, m: 0 }
  return {
    h: parseInt(match[1], 10) % 24,
    m: Math.round(parseInt(match[2], 10) / 5) * 5 % 60,
  }
}

function formatTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface Props {
  open: boolean
  value: string
  onConfirm: (hhmm: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function TimePickerDialog({ open, value, onConfirm, onRemove, onClose }: Props) {
  const [hour,   setHour]   = useState(9)
  const [minute, setMinute] = useState(0)

  useEffect(() => {
    if (open) {
      const p = parseTime(value || '09:00')
      setHour(p.h)
      setMinute(p.m)
    }
  }, [open, value])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Time</DialogTitle>
          <DialogDescription className="sr-only">Select a time</DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <TimeWheels
            hour={hour}
            minute={minute}
            onHourChange={setHour}
            onMinuteChange={setMinute}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => { onRemove(); onClose() }}
          >
            Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => { onConfirm(formatTime(hour, minute)); onClose() }}>Set</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
