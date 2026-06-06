import { X } from 'lucide-react'
import { Badge } from './ui/badge'
import { cn } from '@/lib/utils'

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
  if (isTopic) {
    return (
      <Badge
        variant="link"
        className={cn(
          interactive && onNavigate && 'cursor-pointer underline underline-offset-2 decoration-indigo-400/60',
          interactive && onRemove && 'pr-1',
          className,
        )}
        onClick={interactive && onNavigate ? onNavigate : undefined}
      >
        {label}
        {interactive && onRemove && (
          <button
            type="button"
            className="p-0 flex items-center rounded-sm opacity-60 hover:opacity-100 focus:outline-none"
            onClick={e => { e.stopPropagation(); onRemove() }}
            aria-label={`Remove ${label}`}
          >
            <X size={9} />
          </button>
        )}
      </Badge>
    )
  }

  return (
    <Badge
      variant="tag"
      className={cn(interactive && onRemove && 'pr-1', className)}
    >
      {label}
      {interactive && onRemove && (
        <button
          type="button"
          className="p-0 flex items-center rounded-sm opacity-60 hover:opacity-100 focus:outline-none"
          onClick={e => { e.stopPropagation(); onRemove() }}
          aria-label={`Remove ${label}`}
        >
          <X size={9} />
        </button>
      )}
    </Badge>
  )
}
