import { cva } from 'class-variance-authority'
import type { Priority } from '@/types'
import { VAULT_HUE, type OccHue } from '@/occView'
import type { VaultColor } from '@/vaultRef'

/**
 * Solid fill per hue — the palette in one place. Bars, swatches and
 * mini-calendar dots all paint from this, so a dot always agrees with the
 * chip of the day it sits under.
 *
 * `neutral` is `bg-muted-foreground`, not a new token: it is the only
 * colorless fill every theme already guarantees reads against its surfaces
 * (index.css treats muted-foreground-on-background at 4.58:1 as the floor to
 * hold when retuning) — the fill a vault with no color set gets, active or
 * dimmed alike (see `occBarVariants`/`dvBlockVariants` below).
 */
export const HUE_SOLID: Record<OccHue, string> = {
  event:        'bg-event',
  'priority-1': 'bg-priority-1',
  'priority-2': 'bg-priority-2',
  'priority-3': 'bg-priority-3',
  task:         'bg-task',
  note:         'bg-note',
  neutral:      'bg-muted-foreground',
}

/**
 * Shared pattern for active occurrences: solid bg-{color} + text-{color}-foreground.
 * Full-opacity backgrounds (rather than a light tint) plus a per-domain-color
 * foreground (each theme picks whichever of its two ink colors contrasts best
 * against that specific swatch — see index.css) is deliberate: a light tint
 * behind colored text can't clear AA on light themes, no matter the text
 * color. hover:bg-{color}/90 (matching the buttonVariants hover convention) and an
 * explicit hover:text so neither gets silently overridden by SurfaceButton's own
 * ghost-variant hover styles. Identical across all item-display contexts — one edit
 * here changes every view.
 *
 * `neutral` pairs its muted-foreground fill with `text-background` — the
 * inverse of the pairing index.css tunes for AA in every theme, so it holds
 * wherever that one does.
 */
const TINT_CLASSES = {
  event:        'bg-event text-event-foreground hover:bg-event/90 hover:text-event-foreground',
  task:         'bg-task text-task-foreground hover:bg-task/90 hover:text-task-foreground',
  'priority-1': 'bg-priority-1 text-priority-1-foreground hover:bg-priority-1/90 hover:text-priority-1-foreground',
  'priority-2': 'bg-priority-2 text-priority-2-foreground hover:bg-priority-2/90 hover:text-priority-2-foreground',
  'priority-3': 'bg-priority-3 text-priority-3-foreground hover:bg-priority-3/90 hover:text-priority-3-foreground',
  note:         'bg-note text-note-foreground hover:bg-note/90 hover:text-note-foreground',
  neutral:      'bg-muted-foreground text-background hover:bg-muted-foreground/90 hover:text-background',
} satisfies Record<OccHue, string>

/**
 * 4px accent bar in agenda cards (OccurrenceCard). Coloured by the
 * occurrence's own hue in every state — same `hue`/`dimmed` split as
 * `dvBlockVariants` (opacity-60, no line-through here since the bar carries
 * no text): a done/past card keeps reading as its own kind/priority/vault,
 * just faded, rather than the bar flipping to a flat neutral that erases it.
 */
export const occBarVariants = cva(
  'w-1 self-stretch rounded-full shrink-0 min-h-5',
  {
    variants: {
      hue: HUE_SOLID,
      dimmed: {
        true:  'opacity-60',
        false: '',
      },
    },
    defaultVariants: { hue: 'neutral', dimmed: false },
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
 * blocks (bordered=true) share the same solid fill, coloured by the
 * occurrence's own hue in every state (`hue`, from `OccPainter.hue`, which
 * — unlike `OccPainter.tone` — outlives completion). past/done items dim
 * rather than losing their colour to a flat neutral fill: `opacity-60`
 * fades the whole block toward the page background, the same fade
 * `OccurrenceCard` applies to its own content, plus a line-through. A flat
 * neutral swap (an earlier version of this) reads as a different,
 * disconnected block rather than a de-emphasized version of the same one.
 */
export const dvBlockVariants = cva('', {
  variants: {
    hue: TINT_CLASSES,
    dimmed: {
      true:  'opacity-60 line-through',
      false: '',
    },
    bordered: {
      true:  'border-l-2',
      false: '',
    },
  },
  defaultVariants: { hue: 'neutral', dimmed: false, bordered: false },
})

/**
 * Chip tint per hue — bg-{color}/30 (a tint, not TINT_CLASSES' solid fill)
 * plus text-chip-tint-foreground: a full solid fill reads as too dominant at
 * chip size, and the palette isn't uniformly tuned for it as a full fill +
 * matching -foreground ink across every theme. --chip-tint-foreground is
 * verified >=4.5:1 against every domain color's 30%-opacity tint in every
 * theme (see its doc comment in index.css) — same formula as badge.tsx's
 * `chip`/`link` variants. Deliberately doesn't set a border class: a colored
 * border-{color} doubled up on the tint and read as a ring (see git history),
 * so this leaves the `Badge` `tag` variant's own `border-[var(--chip-border)]`
 * in place instead — the same neutral hairline every other occurrence-card
 * chip (date/time/duration) gets, visible in light themes and transparent in
 * dark ones. An uncolored chip keeps the plain `Badge` styling, border
 * included.
 */
export const HUE_CHIP: Record<OccHue, string> = {
  event:        'bg-event/30 text-chip-tint-foreground',
  'priority-1': 'bg-priority-1/30 text-chip-tint-foreground',
  'priority-2': 'bg-priority-2/30 text-chip-tint-foreground',
  'priority-3': 'bg-priority-3/30 text-chip-tint-foreground',
  task:         'bg-task/30 text-chip-tint-foreground',
  note:         'bg-note/30 text-chip-tint-foreground',
  neutral:      'bg-muted-foreground/30 text-chip-tint-foreground',
}

/**
 * Priority chip active-state colouring — shared between the entry editor's
 * inline priority chip and the priority selection drawer. Same tint as
 * `HUE_CHIP`, gated on aria-pressed and with the border kept (these are
 * pressable, and the border is what shows the pressed state's edge).
 */
export const PRIORITY_CLASS: Record<Priority, string> = {
  high:   'aria-[pressed=true]:bg-priority-1/30 aria-[pressed=true]:text-chip-tint-foreground aria-[pressed=true]:border-priority-1',
  medium: 'aria-[pressed=true]:bg-priority-2/30 aria-[pressed=true]:text-chip-tint-foreground aria-[pressed=true]:border-priority-2',
  low:    'aria-[pressed=true]:bg-priority-3/30 aria-[pressed=true]:text-chip-tint-foreground aria-[pressed=true]:border-priority-3',
}

/** Solid swatch fill for each `VaultColor`, for the color picker in Settings. */
export const VAULT_COLOR_SWATCH: Record<VaultColor, string> = Object.fromEntries(
  Object.entries(VAULT_HUE).map(([color, hue]) => [color, HUE_SOLID[hue]]),
) as Record<VaultColor, string>
