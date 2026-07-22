import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'

interface Props<U extends string> {
  n: number
  unit: U
  units: readonly U[]
  onNChange: (n: number) => void
  onUnitChange: (unit: U) => void
  /** Render the label for a unit option; defaults to the raw unit value. */
  unitLabel?: (unit: U, n: number) => string
  className?: string
}

/**
 * "Repeats every [N] [unit]" input pair: a clamped-to-1-or-more number field
 * (empty while the user is typing, e.g. clearing to enter a new value) paired
 * with a unit Select.
 */
export function NumberUnitInput<U extends string>({
  n,
  unit,
  units,
  onNChange,
  onUnitChange,
  unitLabel,
  className,
}: Props<U>) {
  return (
    <div className={cn('flex gap-2', className)}>
      <Input
        type="number"
        min={1}
        className="w-20"
        value={n === 0 ? '' : n}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const val = e.target.value
          onNChange(val === '' ? 0 : Math.max(1, parseInt(val, 10) || 1))
        }}
      />
      <Select value={unit} onValueChange={(v) => onUnitChange(v as U)}>
        <SelectTrigger className="flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {units.map((u) => (
            <SelectItem key={u} value={u}>
              {unitLabel ? unitLabel(u, n) : u}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
