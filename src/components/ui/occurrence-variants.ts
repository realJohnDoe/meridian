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
 * Shared tint pattern for active tasks and notes: bg-{color}/opacity + text-{color}.
 * Identical across all item-display contexts — one edit here changes every view.
 */
const TINT_CLASSES = {
  'task-open': 'bg-task/18 text-task',
  'task-p1':   'bg-priority-1/15 text-priority-1',
  'task-p2':   'bg-priority-2/15 text-priority-2',
  'task-p3':   'bg-priority-3/15 text-priority-3',
  note:        'bg-note/18 text-note',
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
 * blocks (bordered=true).  Bordered blocks use a slightly higher opacity
 * background and softer text for readability over larger areas.
 */
export const dvBlockVariants = cva('', {
  variants: {
    state: {
      ...TINT_CLASSES,
      'event-future': '',  // both appearances set per bordered in compound variants below
      'event-past':   'bg-muted text-muted-foreground',
      done:           'bg-muted text-muted-foreground',
    } satisfies Record<OccState, string>,
    bordered: {
      true:  'border-l-2',
      false: '',
    },
  },
  compoundVariants: [
    // event-future: lighter pill when unbounded, darker block with accent stripe when bordered
    { state: 'event-future', bordered: false, className: 'bg-event/18 text-event' },
    { state: 'event-future', bordered: true,  className: 'bg-event/32 border-l-event text-secondary-foreground' },
    // all other bordered states just add the matching left accent stripe
    { state: 'task-open',  bordered: true, className: 'border-l-task' },
    { state: 'task-p1',    bordered: true, className: 'border-l-priority-1' },
    { state: 'task-p2',    bordered: true, className: 'border-l-priority-2' },
    { state: 'task-p3',    bordered: true, className: 'border-l-priority-3' },
    { state: 'note',       bordered: true, className: 'border-l-note' },
    { state: 'event-past', bordered: true, className: 'border-l-surface-raised' },
    { state: 'done',       bordered: true, className: 'border-l-surface-raised' },
  ],
  defaultVariants: { state: 'done', bordered: false },
})

export type DvBlockVariants = VariantProps<typeof dvBlockVariants>
