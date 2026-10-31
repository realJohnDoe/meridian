import { Plus, X } from 'lucide-react'
import { Badge, badgeVariants } from './primitives/badge'
import { cn } from '@/lib/cn'

interface TagChipProps {
  /** Display label shown on the chip. */
  label: string
  /** True when this chip represents a wikilink topic (indigo styling). */
  isTopic?: boolean
  /**
   * Interactive mode (entry editor):
   *  - Topics show an underline indicating they are clickable links.
   *  - Both tags and topics show an ✕ remove button.
   */
  interactive?: boolean
  /** Called when the ✕ button is clicked (interactive mode only). */
  onRemove?: () => void
  /** Called when the chip label is clicked (interactive + topic only). */
  onNavigate?: () => void
  className?: string
}

/**
 * Unified chip for tags and topics.
 *
 * Display mode (cards, rows): non-interactive, no ✕, no underline.
 * Interactive mode (entry editor): underline on topics (nav link), ✕ on both.
 */
export default function TagChip({ label, isTopic, interactive, onRemove, onNavigate, className }: TagChipProps) {
  const removeButton = interactive && onRemove && (
    <button
      type="button"
      // Hit area extends right/vertically only: the topic button sits 2px to the left.
      className="relative p-0 flex items-center rounded-sm opacity-60 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring before:absolute before:-inset-y-3 before:-right-3 before:left-0 before:content-['']"
      onClick={e => { e.stopPropagation(); onRemove() }}
      aria-label={`Remove ${label}`}
    >
      <X size={9} />
    </button>
  )

  if (isTopic) {
    const canNavigate = interactive && onNavigate
    return (
      <Badge variant="link" className={className}>
        {canNavigate ? (
          // A sibling of removeButton, not a wrapper around it — Badge stays
          // a plain span so the two controls never nest (invalid HTML: a
          // <button> can't contain another <button>).
          <button
            type="button"
            className="relative cursor-pointer underline underline-offset-2 decoration-current/60 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']"
            onClick={onNavigate}
          >
            {label}
          </button>
        ) : (
          label
        )}
        {removeButton}
      </Badge>
    )
  }

  return (
    <Badge variant="tag" className={cn(className)}>
      {label}
      {removeButton}
    </Badge>
  )
}

interface AddChipProps {
  /** Trigger label, e.g. "add to list" or "person". */
  label: string
  onClick: () => void
}

/**
 * "+ label" trigger button that opens an add-picker (participants, listed-on).
 * Same indigo chip look as the wikilink/topic chips (Badge variant="link"),
 * so the trigger reads as part of the same chip family it's about to add to.
 * No min-height override: the pill look comes from the badge's fixed
 * border-radius being close to half its *natural* height — forcing a taller
 * box while keeping that radius fixed would flatten it into a rounded rect.
 */
export function AddChip({ label, onClick }: AddChipProps) {
  return (
    <button
      type="button"
      className={cn(badgeVariants({ variant: 'link' }), "relative cursor-pointer gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']")}
      onClick={onClick}
    >
      <Plus size={9} />
      {label}
    </button>
  )
}
