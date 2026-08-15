import { ChevronDown } from 'lucide-react'
import { useStore } from '@/store'
import { vaultIcon } from './vaultIcon'
import { cn } from '@/lib/cn'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from './ui/select'

interface Props {
  vaultId: string | null
  /**
   * Set to make the chip a picker over the registered writable vaults. Null (or
   * omitted) renders it as a static label instead — which is what an entry that
   * already exists gets, since moving between vaults is a separate, confirmed
   * action rather than a silent re-target.
   */
  onChange?: ((vaultId: string) => void) | null
  className?: string
}

/**
 * Which vault an entry belongs to (or will be created in), as a small chip.
 *
 * The vault is worth showing on an entry only once more than one can be
 * registered — before that it was implied by there being nowhere else for it to
 * be. This is deliberately the *only* marker on a new entry: the chip says
 * where it will land and lets you change it, so nothing else has to.
 */
export default function VaultChip({ vaultId, onChange, className }: Props) {
  const vaults = useStore(s => s.vaults)
  const vault  = vaults.find(v => v.id === vaultId)
  // Read-only vaults can't receive a new entry, so they're never offered as a
  // target — even though one of them may well be the chip's current value on an
  // entry being *viewed*.
  const targets = vaults.filter(v => v.kind !== 'example')

  if (!vault) return null
  const VaultIcon = vaultIcon(vault.kind)

  const base = cn(
    'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40',
    'px-2 py-0.5 text-xs text-muted-foreground max-w-40',
    className,
  )

  // A picker with one option is a label with a misleading affordance.
  if (!onChange || targets.length < 2) {
    return (
      <span className={base}>
        <VaultIcon className="size-3 stroke-[1.7] shrink-0" />
        <span className="truncate">{vault.name}</span>
      </span>
    )
  }

  return (
    <Select value={vault.id} onValueChange={onChange}>
      <SelectTrigger
        className={cn(base, 'h-auto hover:bg-muted [&>svg]:hidden')}
        aria-label={`Vault: ${vault.name}. Change which vault this entry goes to`}
      >
        <VaultIcon className="size-3 stroke-[1.7] shrink-0" />
        <span className="truncate">{vault.name}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </SelectTrigger>
      <SelectContent>
        {targets.map(v => (
          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
