import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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

  useEffect(() => {
    if (open) setTime(normaliseTime(value || '09:00'))
  }, [open, value])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Time</DialogTitle>
          <DialogDescription className="sr-only">Select a time</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center py-2">
          <TimeWheels value={time} onChange={setTime} />
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
            <Button size="sm" onClick={() => { onConfirm(time); onClose() }}>Set</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
