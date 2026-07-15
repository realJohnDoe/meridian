import { cva, type VariantProps } from 'class-variance-authority'

/** Canonical occurrence state — single domain vocabulary for all styling variants. */
export type OccState =
  | 'event-future'
  | 'event-past'
  | 'task-open'
  | 'task-p1'
  | 'task-p2'
  | 'task-p3'
  | 'note'
  | 'done'

/**
 * Shared color recipe for every occurrence surface, at every density (roomy
 * agenda cards and dense calendar blocks alike): a gentle tint of the state
 * color, a full-strength 1px frame as the hue anchor, and neutral
 * `text-foreground` — dark ink in light themes, light ink in dark themes,
 * the same token either way. Putting neutral text on a tint (rather than
 * colored text, and rather than a fully-saturated fill) decouples contrast
 * from hue entirely, so every state clears AA in every theme without a
 * per-color contrast check, while the frame keeps hues distinguishable even
 * at the small sizes month cells and day blocks render at. The frame wraps
 * the whole shape rather than just the left edge, so it can stay a thin 1px
 * stroke instead of a thicker single-side bar.
 */
export const occVariants = cva(
  'border transition-colors',
  {
    variants: {
      state: {
        'event-future': 'bg-event/15 border-event text-foreground hover:bg-event/25',
        'task-open':    'bg-task/15 border-task text-foreground hover:bg-task/25',
        'task-p1':      'bg-priority-1/15 border-priority-1 text-foreground hover:bg-priority-1/25',
        'task-p2':      'bg-priority-2/15 border-priority-2 text-foreground hover:bg-priority-2/25',
        'task-p3':      'bg-priority-3/15 border-priority-3 text-foreground hover:bg-priority-3/25',
        note:           'bg-note/15 border-note text-foreground hover:bg-note/25',
        'event-past':   'bg-muted border-surface-raised text-muted-foreground line-through hover:bg-muted/70',
        done:           'bg-muted border-surface-raised text-muted-foreground line-through hover:bg-muted/70',
      } satisfies Record<OccState, string>,
    },
    defaultVariants: { state: 'done' },
  },
)

export type OccVariants = VariantProps<typeof occVariants>
