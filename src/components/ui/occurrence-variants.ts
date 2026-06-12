import { cva, type VariantProps } from 'class-variance-authority'

/** Keys returned by occState() in presentation.ts */
export type OccState =
  | 'event-future'
  | 'event-past'
  | 'task-open'
  | 'task-p1'
  | 'task-p2'
  | 'task-p3'
  | 'note'
  | 'done'

/** Keys returned by ccBarClass() in presentation.ts */
export type CcBarState =
  | 'event'
  | 'multiday'
  | 'task'
  | 'task-p1'
  | 'task-p2'
  | 'task-p3'
  | 'note'
  | 'done'

/** Keys returned by occDvClass() in presentation.ts */
export type DvBlockState =
  | 'event'
  | 'past'
  | 'task'
  | 'task-p1'
  | 'task-p2'
  | 'task-p3'
  | 'done'

/**
 * 4px priority bar used in agenda occurrence cards (OccurrenceCard).
 * Pass the result of occState() as the `state` variant.
 * Replaces: .occ-bar + .occ-bar.{state} CSS rules.
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
 * Mini colour-coded label bars inside MonthView calendar cells.
 * Pass the result of ccBarClass() as the `state` variant.
 * Replaces: .cc-bar + .cc-bar.{state} CSS rules.
 */
export const ccBarVariants = cva(
  'rounded-sm py-px px-1 text-3xs font-medium truncate leading-snug shrink-0',
  {
    variants: {
      state: {
        event:     'bg-event/18 text-event',
        multiday:  'bg-event/32 text-event',
        task:      'bg-task/18 text-task',
        'task-p1': 'bg-priority-1/15 text-priority-1',
        'task-p2': 'bg-priority-2/15 text-priority-2',
        'task-p3': 'bg-priority-3/15 text-priority-3',
        note:      'bg-note/18 text-note',
        done:      'bg-muted text-muted-foreground line-through',
      } satisfies Record<CcBarState, string>,
    },
    defaultVariants: { state: 'done' },
  },
)

export type CcBarVariants = VariantProps<typeof ccBarVariants>

/**
 * All-day item pill in DayView.
 * Pass the result of occDvClass() as the `state` variant.
 * Replaces: .dv-aditem.{state} CSS rules (layout stays inline Tailwind).
 */
export const adItemVariants = cva('', {
  variants: {
    state: {
      event:     'bg-event/18 text-event',
      task:      'bg-task/18 text-task',
      'task-p1': 'bg-priority-1/15 text-priority-1',
      'task-p2': 'bg-priority-2/15 text-priority-2',
      'task-p3': 'bg-priority-3/15 text-priority-3',
      past:      'bg-accent text-muted-foreground',
      done:      'bg-accent text-muted-foreground',
    } satisfies Record<DvBlockState, string>,
  },
  defaultVariants: { state: 'done' },
})

export type AdItemVariants = VariantProps<typeof adItemVariants>

/**
 * Timed event blocks in the DayView timeline.
 * Pass the result of occDvClass() as the `state` variant.
 * Replaces: .dv-eblk + .dv-eblk.{state} CSS rules (layout stays inline Tailwind).
 */
export const eventBlockVariants = cva('border-l-2', {
  variants: {
    state: {
      event:     'bg-event/32 border-l-event text-secondary-foreground',
      past:      'bg-accent border-l-surface-raised text-muted-foreground',
      task:      'bg-task/18 border-l-task text-task',
      'task-p1': 'bg-priority-1/15 border-l-priority-1 text-priority-1',
      'task-p2': 'bg-priority-2/15 border-l-priority-2 text-priority-2',
      'task-p3': 'bg-priority-3/15 border-l-priority-3 text-priority-3',
      done:      'bg-accent border-l-surface-raised text-muted-foreground',
    } satisfies Record<DvBlockState, string>,
  },
  defaultVariants: { state: 'event' },
})

export type EventBlockVariants = VariantProps<typeof eventBlockVariants>
