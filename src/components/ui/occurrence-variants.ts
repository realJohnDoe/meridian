import { cva, type VariantProps } from 'class-variance-authority'
import type { OccState } from '@/types'

/**
 * Shared pattern for active tasks and notes: solid bg-{color} + text-{color}-foreground.
 * Full-opacity backgrounds (rather than a light tint) plus a per-domain-color
 * foreground (each theme picks whichever of its two ink colors contrasts best
 * against that specific swatch — see index.css) is deliberate: a light tint
 * behind colored text can't clear AA on light themes, no matter the text
 * color. hover:bg-{color}/90 (matching the buttonVariants hover convention) and an
 * explicit hover:text so neither gets silently overridden by SurfaceButton's own
 * ghost-variant hover styles. Identical across all item-display contexts — one edit
 * here changes every view.
 */
const TINT_CLASSES = {
  'task-open': 'bg-task text-task-foreground hover:bg-task/90 hover:text-task-foreground',
  'task-p1':   'bg-priority-1 text-priority-1-foreground hover:bg-priority-1/90 hover:text-priority-1-foreground',
  'task-p2':   'bg-priority-2 text-priority-2-foreground hover:bg-priority-2/90 hover:text-priority-2-foreground',
  'task-p3':   'bg-priority-3 text-priority-3-foreground hover:bg-priority-3/90 hover:text-priority-3-foreground',
  note:        'bg-note text-note-foreground hover:bg-note/90 hover:text-note-foreground',
}

/**
 * 4px priority bar in agenda cards (OccurrenceCard).
 */
export const occBarVariants = cva(
  'w-1 self-stretch rounded-full shrink-0 min-h-5',
  {
    variants: {
      state: {
        'event-future': 'bg-event',
        'event-past':   'bg-surface-raised',
        'task-open':    'bg-task',
        'task-p1':      'bg-priority-1',
        'task-p2':      'bg-priority-2',
        'task-p3':      'bg-priority-3',
        note:           'bg-note',
        done:           'bg-surface-raised',
      } satisfies Record<OccState, string>,
    },
    defaultVariants: { state: 'done' },
  },
)

export type OccBarVariants = VariantProps<typeof occBarVariants>

/**
 * Mini colour-coded label bars in MonthView calendar cells.
 * Past events and done tasks show struck through.
 */
export const ccBarVariants = cva(
  'rounded-sm py-px px-1 text-3xs font-medium truncate leading-snug shrink-0',
  {
    variants: {
      state: {
        ...TINT_CLASSES,
        'event-future': 'bg-event/18 text-event',
        'event-past':   'bg-muted text-muted-foreground line-through',
        done:           'bg-muted text-muted-foreground line-through',
      } satisfies Record<OccState, string>,
    },
    defaultVariants: { state: 'done' },
  },
)

export type CcBarVariants = VariantProps<typeof ccBarVariants>

/**
 * DayView item colouring — all-day pills (bordered=false) and timed event
 * blocks (bordered=true) share the same solid fill; bordered blocks add a
 * left accent stripe for a bit of extra visual weight over larger areas.
 * past/done items stay on the neutral bg-muted surface (not solid-colored)
 * so they read as de-emphasized against the now fully-saturated active states,
 * with a line-through reinforcing the "done" meaning.
 */
export const dvBlockVariants = cva('', {
  variants: {
    state: {
      ...TINT_CLASSES,
      'event-future': '',  // both appearances set per bordered in compound variants below
      'event-past':   'bg-muted text-foreground line-through hover:bg-muted/90 hover:text-foreground',
      done:           'bg-muted text-foreground line-through hover:bg-muted/90 hover:text-foreground',
    } satisfies Record<OccState, string>,
    bordered: {
      true:  'border-l-2',
      false: '',
    },
  },
  compoundVariants: [
    { state: 'event-future', bordered: false, className: 'bg-event text-event-foreground hover:bg-event/90 hover:text-event-foreground' },
    { state: 'event-future', bordered: true,  className: 'bg-event text-event-foreground hover:bg-event/90 hover:text-event-foreground' },
    // active states are already fully colored, so a same-hue border stripe would be
    // invisible — only event-past/done (neutral bg-muted) benefit from one
    { state: 'event-past', bordered: true, className: 'border-l-surface-raised' },
    { state: 'done',       bordered: true, className: 'border-l-surface-raised' },
  ],
  defaultVariants: { state: 'done', bordered: false },
})

export type DvBlockVariants = VariantProps<typeof dvBlockVariants>
