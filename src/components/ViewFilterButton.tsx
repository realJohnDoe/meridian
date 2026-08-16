import { useMemo, useState } from 'react'
import { Users, ChevronRight } from 'lucide-react'
import { useStore, NO_PARTICIPANT } from '@/store'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { Collapsible, CollapsibleContent } from './ui/collapsible'
import { IconButton } from './primitives/icon-button'
import { VaultIcon } from './vaultIcon'
import { cn } from '@/lib/cn'
import { keyVaultId } from '@/fileIO'
import type { StoreItem } from '@/types'
import type { VaultRef } from '@/vaultActions'

/** One vault's row in the tree: the vault, and the people who appear in it. */
interface VaultGroup {
  vault:        VaultRef
  /** Sorted participant names in this vault. Never includes the sentinel. */
  participants: string[]
  /** Whether anything in this vault has no participants at all. */
  hasUnassigned: boolean
}

/**
 * Group participants by the vault they appear in.
 *
 * Deliberately derived from the occurrences rather than declared anywhere: a
 * vault "has" a participant exactly when one of its entries names them, so two
 * vaults can each list a "Bob" and neither knows about the other's. That is the
 * whole reason `hiddenParticipants` is keyed by vault.
 */
function useVaultGroups(items: StoreItem[], vaults: VaultRef[]): VaultGroup[] {
  return useMemo(() => {
    const byVault = new Map<string, { names: Set<string>; unassigned: boolean }>()
    for (const item of items) {
      // Raw store items carry `OccurrenceMetadata` only — the vault half of
      // the key is where their provenance lives until expansion joins the
      // root's `FileMetadata` in.
      const vaultId = keyVaultId(item.entryKey)
      let bucket = byVault.get(vaultId)
      if (!bucket) { bucket = { names: new Set(), unassigned: false }; byVault.set(vaultId, bucket) }
      let any = false
      for (const p of item.metadata.participants) {
        const trimmed = p.trim()
        if (trimmed) { bucket.names.add(trimmed); any = true }
      }
      if (!any) bucket.unassigned = true
    }
    // Driven by `vaults`, not by the map: a registered vault with no entries
    // yet must still be listed, or there would be no way to un-hide it.
    return vaults.map(vault => {
      const bucket = byVault.get(vault.id)
      return {
        vault,
        participants: bucket ? [...bucket.names].sort() : [],
        hasUnassigned: bucket?.unassigned ?? false,
      }
    })
  }, [items, vaults])
}

type VaultCheckState = 'all' | 'some' | 'none'

/**
 * A vault row is tri-state: the vault itself can be hidden outright, or shown
 * with some of its people hidden. `some` is what renders the indeterminate
 * checkbox, and it is why hiding a vault and hiding all of its people are kept
 * as different states — the first survives new people appearing in that vault,
 * the second does not.
 */
function vaultCheckState(
  group: VaultGroup, hiddenVaultIds: string[], hiddenParticipants: Record<string, string[]>,
): VaultCheckState {
  if (hiddenVaultIds.includes(group.vault.id)) return 'none'
  const hidden = hiddenParticipants[group.vault.id] ?? []
  if (hidden.length === 0) return 'all'
  const rows = group.participants.length + (group.hasUnassigned ? 1 : 0)
  const hiddenRows = group.participants.filter(p => hidden.includes(p)).length
    + (group.hasUnassigned && hidden.includes(NO_PARTICIPANT) ? 1 : 0)
  if (hiddenRows === 0) return 'all'
  return hiddenRows >= rows ? 'none' : 'some'
}

function PersonRow({
  label, italic, checked, onToggle,
}: { label: string; italic?: boolean; checked: boolean; onToggle: () => void }) {
  return (
    // py-3 (rather than the tighter px-1 py-1.5 rows elsewhere) keeps this row
    // at least 44px tall: the checkbox's own invisible touch zone already
    // reaches ~40px via `before:-inset-3`, and a shorter row would let
    // neighbouring rows' zones overlap and mis-tap the wrong person.
    <label className="flex items-center gap-2 cursor-pointer px-1 py-3">
      <Checkbox checked={checked} onCheckedChange={onToggle} visualClassName="size-4" />
      <span className={cn('text-sm truncate', italic && 'text-muted-foreground italic')}>{label}</span>
    </label>
  )
}

/**
 * The view filter — a "which calendars, and who in them" filter over content,
 * so it lives in the topbar rather than the sidebar: it applies to every
 * browsing view (agenda, month, week, day, backlog, notes) and needs to stay
 * visible on the screen it is narrowing. The topbar hides it on entry routes,
 * which is exactly right — the filter stops at the document boundary.
 *
 * Visibility is *only* this control. Whether a vault is registered (and so
 * whether it syncs) is Settings' business, and its sync status is
 * `SyncButton`'s — three concepts, three homes, which is what this plan's
 * split of `activeVaultId` exists to make legible.
 */
export default function ViewFilterButton() {
  const items                    = useStore(s => s.items)
  const vaults                   = useStore(s => s.vaults)
  const hiddenVaultIds           = useStore(s => s.hiddenVaultIds)
  const hiddenParticipants       = useStore(s => s.hiddenParticipants)
  const toggleVaultHidden        = useStore(s => s.toggleVaultHidden)
  const toggleParticipantHidden  = useStore(s => s.toggleParticipantHidden)
  const clearVaultParticipants   = useStore(s => s.clearVaultParticipants)
  const clearViewFilter          = useStore(s => s.clearViewFilter)

  const groups = useVaultGroups(items, vaults)
  const [expanded, setExpanded] = useState<string | null>(null)

  const active = hiddenVaultIds.length > 0
    || Object.values(hiddenParticipants).some(list => list.length > 0)

  // Below two vaults the tree is pure overhead — there is no second calendar to
  // distinguish anyone from — so it collapses to the flat people list
  // single-vault users already know.
  const flat = groups.length < 2
  const flatGroup = groups[0]

  if (groups.length === 0) return null
  if (flat && flatGroup && flatGroup.participants.length === 0) return null

  const hiddenCount = hiddenVaultIds.length
    + Object.values(hiddenParticipants).reduce((n, list) => n + list.length, 0)
  const label = active ? `${hiddenCount} hidden` : null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={active ? 'sm' : 'icon'}
          className={active
            ? 'rounded-full shrink-0 gap-1.5 max-w-40 text-accent-foreground bg-accent'
            : 'rounded-full shrink-0 text-dim'}
          aria-label={active ? `${hiddenCount} hidden. Change calendar and people filter` : 'Filter calendars and people'}
        >
          <Users size={18} className="shrink-0" />
          {label && <span className="truncate text-sm">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="flex items-center px-1 pb-1">
          <span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {flat ? 'Filter by person' : 'Calendars & people'}
          </span>
          {active && (
            <button
              // Real padding (not the checkbox's overlapping ::before trick):
              // this sits alone in the header with room to grow, so a plain
              // 24px-plus hit area is simpler and clears the AA floor.
              className="text-2xs text-muted-foreground hover:text-foreground transition-colors -my-2 -mr-1 px-1.5 py-2"
              onClick={clearViewFilter}
            >
              Clear
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto flex flex-col">
          {flat && flatGroup ? (
            <>
              {flatGroup.hasUnassigned && (
                <PersonRow
                  label="No participants"
                  italic
                  checked={!(hiddenParticipants[flatGroup.vault.id] ?? []).includes(NO_PARTICIPANT)}
                  onToggle={() => toggleParticipantHidden(flatGroup.vault.id, NO_PARTICIPANT)}
                />
              )}
              {flatGroup.participants.map(p => (
                <PersonRow
                  key={p}
                  label={p}
                  checked={!(hiddenParticipants[flatGroup.vault.id] ?? []).includes(p)}
                  onToggle={() => toggleParticipantHidden(flatGroup.vault.id, p)}
                />
              ))}
            </>
          ) : groups.map(group => {
            const state    = vaultCheckState(group, hiddenVaultIds, hiddenParticipants)
            const hidden   = hiddenParticipants[group.vault.id] ?? []
            const hasPeople = group.participants.length > 0 || group.hasUnassigned
            const isOpen   = expanded === group.vault.id
            return (
              <Collapsible
                key={group.vault.id}
                open={isOpen}
                onOpenChange={open => setExpanded(open ? group.vault.id : null)}
              >
                <div className="flex items-center gap-1 px-1 py-2.5">
                  {/* A plain IconButton, not CollapsibleTrigger asChild: IconButton
                      isn't ref-forwarding, which Radix's Slot needs to manage focus
                      cleanly. `aria-expanded` is set by hand to keep the a11y
                      contract CollapsibleTrigger would otherwise have provided. */}
                  <IconButton
                    hit="pad"
                    variant="plain"
                    label={isOpen ? `Collapse ${group.vault.name}` : `Expand ${group.vault.name}`}
                    aria-expanded={isOpen}
                    disabled={!hasPeople}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-0"
                    onClick={() => setExpanded(isOpen ? null : group.vault.id)}
                  >
                    <ChevronRight size={13} className={cn('transition-transform', isOpen && 'rotate-90')} />
                  </IconButton>
                  {/* The vault checkbox shows and hides the whole calendar; its
                      indeterminate state reports that some of its people are
                      hidden, and clicking it from there shows everything again
                      — it never hides the vault itself from a mixed state. */}
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0 py-0.5">
                    <Checkbox
                      checked={state === 'some' ? 'indeterminate' : state === 'all'}
                      onCheckedChange={() => state === 'some'
                        ? clearVaultParticipants(group.vault.id)
                        : toggleVaultHidden(group.vault.id)}
                      visualClassName="size-4"
                    />
                    <VaultIcon kind={group.vault.kind} className="size-3.5 stroke-[1.7] shrink-0 text-muted-foreground" />
                    <span className="text-sm truncate">{group.vault.name}</span>
                  </label>
                </div>
                <CollapsibleContent className="pl-7">
                  {group.hasUnassigned && (
                    <PersonRow
                      label="No participants"
                      italic
                      checked={!hidden.includes(NO_PARTICIPANT)}
                      onToggle={() => toggleParticipantHidden(group.vault.id, NO_PARTICIPANT)}
                    />
                  )}
                  {group.participants.map(p => (
                    <PersonRow
                      key={p}
                      label={p}
                      checked={!hidden.includes(p)}
                      onToggle={() => toggleParticipantHidden(group.vault.id, p)}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
