import { startOfDay } from 'date-fns'
import { parseDurationDays, parseDurationHours } from '@/model'
import { isTracked, type Occurrence, type Priority } from './types'
import type { VaultColor } from './vaultRef'

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

/** Derive the display kind from occurrence data. */
export function occKind(occ: Occurrence): 'event' | 'task' | 'note' {
  return isTracked(occ) ? 'task' : occ.date ? 'event' : 'note'
}

/** True when the occurrence belongs to a recurring series (has an ownerId). */
export function occIsRecur(occ: Occurrence): boolean {
  return !!occ.ownerId
}

/**
 * True when the entry backing `meta` is archived — hidden from every
 * calendar surface and search. Structural rather than typed to `Occurrence`
 * or `FileMetadata` specifically: both shapes carry `archived` directly
 * (`AppMetadata` includes `FileMetadata` verbatim, see `joinFileMeta`), so
 * this serves `useCalendarFilter` (over `Occurrence.metadata`) and
 * `fileEntries` (over a `Roots` value) alike — one predicate rather than
 * `meta.archived` inlined at every site. See GLOSSARY.md `archived`.
 */
export function isArchived(meta: { archived?: boolean }): boolean {
  return !!meta.archived
}

/**
 * `now` defaults to the wall clock for callers that don't have a live-updating
 * value on hand (sorting, one-off renders). Components that stay mounted
 * across time (e.g. OccurrenceCard in the agenda) should pass an explicit,
 * externally-refreshed `now` instead, so this stays a pure function of its
 * arguments and can be safely memoized by the caller.
 */
export function occState(o: Occurrence, now: Date = new Date()): OccState {
  if (o.metadata.done) return 'done'
  const kind = occKind(o)
  if (kind === 'note') return 'note'
  if (kind === 'task') {
    const p = o.metadata.priority
    if (p === 'high')   return 'task-p1'
    if (p === 'medium') return 'task-p2'
    if (p === 'low')    return 'task-p3'
    return 'task-open'
  }
  const today = startOfDay(now)
  if ((parseDurationDays(o.metadata.duration) ?? 0) >= 2) {
    // Use day-level comparison: past days of a multiday event get the gray shader,
    // today and future days stay purple.
    if (o.metadata.jsTime) {
      const day = startOfDay(o.metadata.jsTime)
      if (day < today) return 'event-past'
    }
    return 'event-future'
  }
  if (o.metadata.jsTime && o.metadata.jsTime < now) {
    // Whole-day events (no time) use day-level comparison — they stay colored
    // until midnight, not until 00:01 AM when jsTime (midnight) < now.
    if (!o.time) {
      const eventDay = startOfDay(o.metadata.jsTime)
      if (eventDay >= today) return 'event-future'
    } else if (o.metadata.duration) {
      // Timed event with explicit duration: still future while the event is ongoing.
      const endMs = o.metadata.jsTime.getTime() + parseDurationHours(o.metadata.duration) * 3_600_000
      if (endMs > now.getTime()) return 'event-future'
    }
    return 'event-past'
  }
  return 'event-future'
}

// ── Painting ─────────────────────────────────────────────────────────────────
// `OccState` says what an occurrence *is*; the vocabulary below says how it is
// *painted*. The two were one union until occurrences could be colored by
// their vault, which is a second source for the same six swatches — keeping
// them apart is what stops every styling map from having to know about vaults.

/**
 * Which source picks an occurrence's color. A device preference
 * (`store.ts` · `colorBy`), set explicitly in Settings — nothing switches it
 * automatically.
 *
 * `'type'`  — kind and priority (the original behaviour).
 * `'vault'` — the vault the occurrence came from.
 */
export type OccColorBy = 'type' | 'vault'

/**
 * The six palette swatches an *active* occurrence can be painted with, plus
 * `'neutral'` for one that has no color to show — a vault with no color set,
 * under `colorBy: 'vault'`. Deliberately named after the palette tokens
 * (`bg-event`, `bg-priority-1`, …) rather than after the domain, because both
 * color sources land here: `VaultColor`'s six values are aliases of these very
 * tokens (see `VAULT_HUE`), so coloring by vault introduces no new palette.
 */
export type OccHue =
  | 'event'
  | 'priority-1'
  | 'priority-2'
  | 'priority-3'
  | 'task'
  | 'note'
  | 'neutral'

/**
 * What `OccPainter.tone` reports: an active hue, or one of the two
 * de-emphasized treatments. Not exported — every surface that paints an
 * occurrence now uses `hue` (which outlives completion) plus a separate
 * `dimmed` boolean instead (see `dvBlockVariants`/`occBarVariants` in
 * `components/primitives/occurrence-variants.ts`), so nothing outside this
 * file names the collapsed type anymore; `tone`/`isPast` in OccurrenceCard.tsx
 * is the one remaining consumer, structurally typed off `OccPainter` itself.
 */
type OccTone = OccHue | 'past' | 'done'

/** Hue order for anything that has to show several at once (mini-calendar dots). */
export const HUE_ORDER: OccHue[] = [
  'event', 'priority-1', 'priority-2', 'priority-3', 'task', 'note', 'neutral',
]

/** `VaultColor` → the palette swatch it is a name for. The one alias table. */
export const VAULT_HUE: Record<VaultColor, OccHue> = {
  indigo: 'event',
  red:    'priority-1',
  orange: 'priority-2',
  yellow: 'priority-3',
  green:  'task',
  blue:   'note',
}

/** Priority → the palette swatch the type-based coloring gives it. */
const PRIORITY_HUE: Record<Priority, OccHue> = {
  high:   'priority-1',
  medium: 'priority-2',
  low:    'priority-3',
}

/** Display labels for `Priority`, for the chip and the editor's priority row. */
export const PRIORITY_LABELS: Record<Priority, string> = {
  high:   'High',
  medium: 'Medium',
  low:    'Low',
}

/**
 * Type-based hue: kind, then priority. Derived from occurrence data rather
 * than from `occState()` because it must survive completion — a done task's
 * mini-calendar dot still shows the priority it had (see `dayDots.ts`). For
 * every state `occState` does *not* collapse, this agrees with it exactly,
 * which is why `OccPainter.tone` can layer the two neutral treatments on top
 * of this one function instead of carrying a second state→hue table.
 */
export function typeHue(o: Occurrence): OccHue {
  const kind = occKind(o)
  if (kind === 'note')  return 'note'
  if (kind === 'event') return 'event'
  const p = o.metadata.priority
  return p ? PRIORITY_HUE[p] : 'task'
}

/**
 * The one chip an occurrence surface shows beside its title, or `null`.
 * Which one it is follows from `colorBy` alone: coloring by type leaves the
 * vault unsaid, so the chip names the vault; coloring by vault leaves priority
 * unsaid, so the chip names the priority. Both halves of that swap are decided
 * in `OccPainter.chip` so no component has to branch on the preference.
 */
interface OccChip {
  kind:  'vault' | 'priority'
  label: string
  /** Tint for the chip, or `undefined` for a plain, uncolored one. */
  hue?:  OccHue
}

/**
 * Everything the display vocabulary can say about one occurrence, bound to the
 * current preference and vault list. Built once per view (`useOccPainter`) and
 * called per row: the pill/block/card call sites are `.map()` loops and plain
 * render functions, so a per-occurrence hook is not an option, and a closure
 * also keeps one store subscription per view instead of one per row.
 */
export interface OccPainter {
  /** Fill for the card stripe, pill and timed block. */
  tone: (o: Occurrence, now?: Date) => OccTone
  /** Color ignoring completion — mini-calendar dots, which outlive `done`.
   *  Declared as a property, not a method, so callers can hand it straight to
   *  `dayDotsFor` without tripping `@typescript-eslint/unbound-method`. */
  hue: (o: Occurrence) => OccHue
  /** Vault chip or priority chip, per `colorBy`. */
  chip: (o: Occurrence) => OccChip | null
  /**
   * Whether `chip` would return one, without building it.
   *
   * The chip is one of the things that decides whether `OccurrenceCard`
   * renders its meta row at all, so the agenda's row-height estimate has to
   * ask — for every unmeasured row, every time the virtualizer recomputes its
   * measurements. See `calendar/agendaSections.ts`'s `estimateRow`.
   */
  hasChip: (o: Occurrence) => boolean
}

export interface OccPainterOptions {
  colorBy: OccColorBy
  /** Every registered vault — enough of `VaultRef` to name and color one. */
  vaults: readonly { id: string; name: string; color?: VaultColor }[]
  /** Vaults hidden by the view filter; they only decide whether the vault
   *  chip is worth showing, never how anything is colored. */
  hiddenVaultIds?: readonly string[]
}

export function makeOccPainter(
  { colorBy, vaults, hiddenVaultIds = [] }: OccPainterOptions,
): OccPainter {
  const byId = new Map(vaults.map(v => [v.id, v]))
  // With one vault on screen the chip would sit on every card saying nothing.
  const multiVault = vaults.filter(v => !hiddenVaultIds.includes(v.id)).length >= 2

  const vaultHue = (o: Occurrence): OccHue => {
    const color = byId.get(o.metadata.vaultId)?.color
    return color ? VAULT_HUE[color] : 'neutral'
  }
  const hue = colorBy === 'vault' ? vaultHue : typeHue

  // Which chip an occurrence gets, decided without building one. Split out of
  // `chip` below so `hasChip` can answer from the same rules rather than a
  // second copy of them: the agenda's row-height estimate asks the question
  // for every not-yet-measured row on every measurement pass, where allocating
  // a chip object per ask is real cost — and a paraphrase of these rules is
  // exactly the kind of drift that made that estimate wrong to begin with.
  const chipKind = (o: Occurrence): OccChip['kind'] | null => {
    if (colorBy === 'vault') {
      return occKind(o) === 'task' && o.metadata.priority ? 'priority' : null
    }
    if (!multiVault) return null
    return byId.has(o.metadata.vaultId) ? 'vault' : null
  }

  return {
    hue,
    tone: (o, now) => {
      const state = occState(o, now)
      if (state === 'done')       return 'done'
      if (state === 'event-past') return 'past'
      return hue(o)
    },
    chip: (o) => {
      const kind = chipKind(o)
      if (kind === null) return null
      if (kind === 'priority') {
        // Non-null: chipKind answers 'priority' only for a task carrying one.
        const p = o.metadata.priority!
        return { kind: 'priority', label: PRIORITY_LABELS[p], hue: PRIORITY_HUE[p] }
      }
      // Non-null: chipKind answers 'vault' only for an id byId holds.
      const v = byId.get(o.metadata.vaultId)!
      return { kind: 'vault', label: v.name, hue: v.color ? VAULT_HUE[v.color] : undefined }
    },
    hasChip: (o) => chipKind(o) !== null,
  }
}
