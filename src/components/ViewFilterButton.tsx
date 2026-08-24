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

  // Only count hidden state against vaults that still exist: a vault that
  // was later removed leaves its hiddenVaultIds/hiddenParticipants entry
  // behind (nothing prunes it), and that stale entry must not keep the
  // indicator lit for a filter that no longer affects anything.
  const liveVaultIds = new Set(vaults.map(v => v.id))
  const active = hiddenVaultIds.some(id => liveVaultIds.has(id))
    || Object.entries(hiddenParticipants).some(([id, list]) => liveVaultIds.has(id) && list.length > 0)

  // Below two vaults the tree is pure overhead — there is no second calendar to
  // distinguish anyone from — so it collapses to the flat people list
  // single-vault users already know.
  const flat = groups.length < 2
  const flatGroup = groups[0]

  if (groups.length === 0) return null
  if (flat && flatGroup && flatGroup.participants.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full shrink-0 text-dim"
          aria-label={active ? 'Filters active. Change calendar and people filter' : 'Filter calendars and people'}
        >
          <Users size={18} className="shrink-0" />
          {active && (
            // A plain dot, not a count: which calendars/people are hidden is
            // one popover-click away, and a number here would just resurrect
            // the old "N hidden" ambiguity (vaults? people? both?) in miniature.
            <span
              aria-hidden="true"
              className="absolute top-2.5 right-2.5 size-2 rounded-full bg-primary ring-2 ring-background"
            />
          )}
        </Button>
      </PopoverTrigger>
      {/* pb-0.5 (not p-2's uniform 8px): rows already carry py-2.5/py-3 of
          their own, so an 8px bottom on top of that left more space under
          the last row than px-2 leaves to its left. pb-0.5 brings the two
          back in line for the common (nothing expanded) resting state. */}
      <PopoverContent className="w-64 px-2 pt-2 pb-0.5" align="end">
        <div className="flex items-center px-1 pb-1">
          <span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {flat ? 'Filter by person' : 'Calendars & people'}
          </span>
          {active && (
            <button
              type="button"
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
            // Only *named* participants earn a disclosure — a vault whose
            // entries are all unassigned has nothing a second "No
            // participants" row would add: hiding it is identical to hiding
            // the vault checkbox itself, so it renders as a plain leaf row.
            const hasPeople = group.participants.length > 0
            const isOpen   = expanded === group.vault.id

            if (!hasPeople) {
              return (
                <div key={group.vault.id} className="flex items-center gap-1 px-1 py-2.5">
                  {/* Empty spacer matching the chevron IconButton's footprint
                      (p-1.5 padding + a 13px icon = 25px) so this leaf row's
                      checkbox lines up with expandable rows' checkboxes, even
                      though it has no disclosure triangle of its own. */}
                  <span aria-hidden="true" className="inline-block size-[25px] shrink-0" />
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
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
              )
            }

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
                    className="text-muted-foreground hover:text-foreground"
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
                {/* pl-13 lines the participant checkboxes up under the vault's
                    *icon*, so participant name text lands under the vault name
                    text above it — clearer nesting for a shallow tree than
                    matching the chevron's indent would give. */}
                <CollapsibleContent className="pl-13">
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
