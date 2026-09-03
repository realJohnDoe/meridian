import { cva } from 'class-variance-authority'
import type { Priority } from '@/types'
import type { OccState } from '@/occView'
import type { VaultColor } from '@/vaultRef'

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

/**
 * Shared corner radius for every surface in the day/week/month grid views —
 * month-view day-cell chips/bars, day/week all-day pills, day/week
 * TimedBlocks, and the neutral bg-muted background rects behind them
 * (DayPane/WeekPane hour cells, the month grid's CELL_CLASS in
 * timelineGeometry). Kept tight (4px) at
 * every width — including large screens — rather than growing to match the
 * agenda view's OccurrenceCard radius (rounded-lg). The agenda view itself
 * is deliberately excluded — OccurrenceCard/AgendaRow is a separate, more
 * widely-shared component (also used by search results and the editor's
 * items list) and keeps its own rounded-lg unconditionally. Kept in one
 * place so the grid views can't drift apart the way month view once did
 * (see git history on MonthGrid.tsx, when its chips were bumped to
 * rounded-sm/md without updating this radius).
 */
export const occRadius = 'rounded-[4px]'

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

/**
 * Priority chip active-state colouring — shared between the entry editor's
 * inline priority chip and the priority selection drawer. bg-{color}/15 (a
 * tint, not TINT_CLASSES' solid fill) plus text-chip-tint-foreground: a full
 * solid fill reads as too dominant at this size, and the palette isn't
 * uniformly tuned for it as a full fill + matching -foreground ink across
 * every theme. --chip-tint-foreground is verified >=4.5:1 against every
 * domain color's 15%-opacity tint in every theme (see its doc comment in
 * index.css) — same formula as badge.tsx's `chip`/`link` variants.
 */
export const PRIORITY_CLASS: Record<Priority, string> = {
  high:   'aria-[pressed=true]:bg-priority-1/15 aria-[pressed=true]:text-chip-tint-foreground aria-[pressed=true]:border-priority-1',
  medium: 'aria-[pressed=true]:bg-priority-2/15 aria-[pressed=true]:text-chip-tint-foreground aria-[pressed=true]:border-priority-2',
  low:    'aria-[pressed=true]:bg-priority-3/15 aria-[pressed=true]:text-chip-tint-foreground aria-[pressed=true]:border-priority-3',
}

/**
 * Maps each `VaultColor` to one of the app's existing domain color tokens —
 * indigo/red/orange/yellow/green/blue are exactly `event`/`priority-1`/
 * `priority-2`/`priority-3`/`task`/`note` under different names, so a vault
 * color introduces no new palette. Same bg-{color}/15 tint + border-{color}
 * pattern as `PRIORITY_CLASS` above, applied to the vault-source chip shown
 * on occurrence cards (`OccurrenceCard`) when that vault has a color set; no
 * color at all keeps the chip's plain `Badge` styling.
 */
export const VAULT_COLOR_CHIP: Record<VaultColor, string> = {
  indigo: 'bg-event/15 text-chip-tint-foreground border-event',
  red:    'bg-priority-1/15 text-chip-tint-foreground border-priority-1',
  orange: 'bg-priority-2/15 text-chip-tint-foreground border-priority-2',
  yellow: 'bg-priority-3/15 text-chip-tint-foreground border-priority-3',
  green:  'bg-task/15 text-chip-tint-foreground border-task',
  blue:   'bg-note/15 text-chip-tint-foreground border-note',
}

/** Solid swatch fill for each `VaultColor`, for the color picker in Settings. */
export const VAULT_COLOR_SWATCH: Record<VaultColor, string> = {
  indigo: 'bg-event',
  red:    'bg-priority-1',
  orange: 'bg-priority-2',
  yellow: 'bg-priority-3',
  green:  'bg-task',
  blue:   'bg-note',
}
