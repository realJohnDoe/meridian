import { fmtT } from '@/model'
import { formatDurationChip, fmtDuration } from '@/format'
import { SurfaceButton } from '@/components/primitives/surface-button'
import { cn } from '@/lib/cn'
import type { Occurrence } from '@/types'
import { useOccPainter } from '@/hooks'
import { dvBlockVariants, occRadius } from '@/components/primitives/occurrence-variants'
import { HP, TOP_PAD, blockGeometry } from './timelineGeometry'

// Badges take a second row, so they only render on blocks with an hour of
// height to spare — a 45-min slot is ~38px, which the title alone fills.
const EVENT_BADGE_MIN_HOURS = 1
// …and only on blocks wide enough for the chips to sit on one line, since
// colliding events narrow the columns and the title (the more important bit)
// should win the space. Two gates because the two chip sets are wildly
// different lengths: fmtDuration spells its length out in full, so a duration
// chip reads "until 3:15 PM (5 hours, 30 minutes)" (~36ch), while a lone start
// time is ~8ch — one threshold sized for the former would needlessly strip the
// latter off perfectly roomy blocks. Enforced as container queries against the
// block itself (see the `@container` marker on SurfaceButton below), so no JS
// measurement is involved. These must stay literal class strings — Tailwind
// only generates what it can see in the source.
const BADGE_WIDTH_GATE = '@max-[280px]:hidden'      // start time + duration chip
const TIME_ONLY_WIDTH_GATE = '@max-[96px]:hidden'   // start-time chip alone
// Ghost pill for the time/duration badges: a translucent tint of the block's
// own foreground ink (bg-current), so it contrasts on every block state/theme
// without hardcoding a surface color the way Badge's `tag` variant does.
const eventPillCls =
  'inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-medium leading-none bg-current/20 whitespace-nowrap'

interface TimedBlockProps {
  o: Occurrence
  dh: number
  colIndex: number
  totalCols: number
  hour12: boolean
  onOpen: (o: Occurrence) => void
  /** Wraps the title instead of truncating it — the week view's columns are
   * too narrow to fit most titles on one line, so they wrap onto a second
   * rather than clipping. Unset (truncate) for the day view's wider blocks. */
  compact?: boolean
}
// painter.tone(o) intentionally keeps occState's default (true wall clock),
// not a pane-frozen clockValue a caller might have on hand — see DayPane's
// AllDayItem for the fuller rationale (painting doesn't need the same
// non-live-clock fallback sortOccs relies on).
export function TimedBlock({ o, dh, colIndex, totalCols, hour12, onOpen, compact }: TimedBlockProps) {
  const h   = (o.metadata.jsTime?.getHours() ?? 0) + (o.metadata.jsTime?.getMinutes() ?? 0) / 60
  const top = h * HP + TOP_PAD + 1
  const height = Math.max(dh * HP - 4, 28)

  const { left, width } = blockGeometry(colIndex, totalCols)

  // Same formatting the agenda OccurrenceCard uses: locale-aware start time and
  // a "until HH:MM (1 hour)" duration chip, instead of the old `10:00 · 1h` line.
  const timeLabel = fmtT(o.time, hour12)
  const durationLabel = o.metadata.duration
    ? (o.time
        ? formatDurationChip(o.metadata.duration, { date: o.date, time: o.time }, hour12)
        : fmtDuration(o.metadata.duration))
    : null

  // Same chip OccurrenceCard shows, on the same terms — the vault's name while
  // coloring by type, the priority while coloring by vault (see OccPainter).
  const painter = useOccPainter()
  const chip = painter.chip(o)

  const showBadges = dh >= EVENT_BADGE_MIN_HOURS
  const badgeWidthGate = durationLabel ? BADGE_WIDTH_GATE : TIME_ONLY_WIDTH_GATE
  const ariaLabel = [o.metadata.title, timeLabel, o.metadata.duration, chip?.label].filter(Boolean).join(', ')

  return (
    <SurfaceButton
      className={cn(
        dvBlockVariants({ tone: painter.tone(o) }),
        // gap-1 both matches the title/meta spacing OccurrenceCard uses and
        // overrides the gap-2 Button's base classes apply — in this flex-col
        // that gap lands between the title and the badge row, and its 8px is
        // what pushed a 1h block's content (8+16+8+14+8 = 54px) past the 52px
        // it has to render in. At gap-1 that comes to 50px and fits.
        '@container absolute flex flex-col items-start gap-1 px-2 text-xs font-medium overflow-hidden transition-colors',
        occRadius,
        // Sub-hour blocks bottom out at a 28px floor, which py-2 would overflow
        // on the title's 16px line box alone (8+16+8), clipping its descenders.
        showBadges ? 'py-2' : 'py-1',
        // Blocks sit inside a pointer-events-none positioning wrapper (see
        // DayPane) so empty timeline space still click-creates underneath —
        // this opts each block itself back in.
        'pointer-events-auto',
      )}
      style={{ top, height, left, width }}
      onClick={() => onOpen(o)}
      aria-label={ariaLabel}
    >
      <div className={cn(
        'w-full shrink-0 font-semibold overflow-hidden',
        compact ? 'whitespace-normal break-words line-clamp-2' : 'text-ellipsis whitespace-nowrap',
      )}>
        {o.metadata.title}
      </div>
      {showBadges && (
        <div className={cn('flex flex-wrap gap-1', badgeWidthGate)}>
          {timeLabel && <span className={eventPillCls}>{timeLabel}</span>}
          {durationLabel && <span className={eventPillCls}>{durationLabel}</span>}
          {chip && <span className={eventPillCls}>{chip.label}</span>}
        </div>
      )}
    </SurfaceButton>
  )
}
