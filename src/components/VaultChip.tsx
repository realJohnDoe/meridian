import { ChevronDown } from 'lucide-react'
import { useStore } from '@/store'
import { isWritableVault } from '@/vaultRef'
import { VaultIcon } from './vaultIcon'
import { cn } from '@/lib/cn'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from './ui/select'

interface Props {
  vaultId: string | null
  /**
   * Set to make the chip a picker over the registered writable vaults. Null (or
   * omitted) renders it as a static label instead — which is what a non-writable
   * vault's entry gets, since a move may go neither into nor out of one.
   *
   * What picking does depends on the entry: before its first save it simply
   * re-targets where the file will be created; afterwards it asks to *move* the
   * file, which the caller confirms first (see `MoveVaultDialog`). The chip
   * itself doesn't know the difference — it reports the choice.
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
  // Only writable vaults are offered: a subscription has no file to write and
  // the Tutorial vault discards what it's given. Either can still be the chip's
  // *current* value on an entry being viewed — hence a filter over the targets,
  // not over the whole list.
  const targets = vaults.filter(isWritableVault)

  if (!vault) return null

  const base = cn(
    'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40',
    'px-2 py-0.5 text-xs text-muted-foreground max-w-40',
    className,
  )

  // A picker with one option is a label with a misleading affordance.
  if (!onChange || targets.length < 2) {
    return (
      <span className={base}>
        <VaultIcon kind={vault.kind} className="size-3 stroke-[1.7] shrink-0" />
        <span className="truncate">{vault.name}</span>
      </span>
    )
  }

  return (
    <Select value={vault.id} onValueChange={onChange}>
      <SelectTrigger
        className={cn(base, 'h-auto hover:bg-muted [&>svg]:hidden')}
        aria-label={`Vault: ${vault.name}. Change which vault this entry is in`}
      >
        <VaultIcon kind={vault.kind} className="size-3 stroke-[1.7] shrink-0" />
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
