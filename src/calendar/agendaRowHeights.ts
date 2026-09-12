import type { Occurrence } from '@/types'
import type { AgendaRow } from './agendaSections'

// Size estimates for the virtualizer. Real sizes are measured after render
// (measureElement); accurate estimates just keep the scrollbar/scrollToIndex
// stable before a row has been measured. initialMeasurementsCache means
// returning users always get real sizes — estimates only matter on first visit.
//
// HEADER_H:    the overdue toggle row.
// MONTH_H:     the big per-month divider ("August 2026").
// WEEK_H:      the smaller per-week divider ("Week 32, Aug 3 – 9").
// ROW_H_META:  OccurrenceCard min-h-11 + py-2 padding + a meta row + AgendaRow mb-1.5 (6) ≈ 68px
// ROW_H_PLAIN: the same card with no meta row, so it sits on its min-h-11 (44)
//              floor + mb-1.5 (6) = 50px — the figure OccurrenceList.ts already
//              uses for exactly this shape.
// EMPTY_H:     a day-empty row (badge + "No events" text), no card at all —
//              min-h-11 (44) + its own mt-3 (12) + mb-1.5 (6), always a fresh
//              day.
// DAY_GAP_H:   AgendaRow's mt-3 (12), carried by a day's *first* occurrence row
//              only (`badge !== null`) — the day-to-day breathing room. It is
//              inside the box the virtualizer measures: VirtualRows positions
//              each row absolutely, and an absolutely positioned box
//              establishes a block formatting context, so a child's top margin
//              can't collapse out of it. AgendaOverdueGroupRow has no
//              equivalent — an overdue row never starts a day.
// Update these if the corresponding row component's padding changes.
const HEADER_H = 40
const MONTH_H = 60
const WEEK_H = 36
const ROW_H_META = 68
const ROW_H_PLAIN = 50
const EMPTY_H = 62
const DAY_GAP_H = 12
// OVERDUE_GROUP_H: the same card as ROW_H_META — an overdue group row always
// shows its oldest date, so its meta row is never absent.
const OVERDUE_GROUP_H = 68

/**
 * The two inputs to `OccurrenceCard`'s meta row that a row list can't see,
 * asked as one question: neither the painter's chip (a *preference* —
 * `colorBy` plus the vault list, see `OccPainter.hasChip`) nor `listedOn` (the
 * store's backlink index) is row data, and both force the meta row exactly the
 * way a time or a duration does.
 *
 * A probe rather than a field on the row, because both change independently of
 * the row list — switching `colorBy` or landing a vault's backlinks would
 * otherwise have to rebuild every row to correct a height estimate. AgendaView
 * builds the one implementation; see its `extraMeta`.
 */
export type ExtraMetaProbe = (o: Occurrence) => boolean

/**
 * Whether this row's card will render its meta row, mirroring OccurrenceCard's
 * own `showMeta`. AgendaView passes neither `showTime` nor
 * `showTagsParticipants`, so of the inputs that vary here the row itself
 * carries three — the date badge (overdue rows, which pass showDate), the time
 * badge and the duration chip — and `extraMeta` answers for the other two.
 *
 * Getting this wrong is not cosmetic. An occurrence row that renders a meta
 * row and was estimated without one is 18px short, and the virtualizer can
 * only discover that once the row is mounted: it corrects the size after the
 * fact, shifting everything below it in a frame the user sees. Under the
 * default `colorBy: 'type'` with two or more visible vaults, *every* card
 * carries a vault chip — so a probe that couldn't see the chip made that miss
 * the norm rather than the exception.
 */
function hasMetaRow(r: Extract<AgendaRow, { kind: 'occ' }>, extraMeta: ExtraMetaProbe): boolean {
  return r.showDate || !!r.occ.time || !!r.occ.metadata.duration || extraMeta(r.occ)
}

export function estimateRow(r: AgendaRow, extraMeta: ExtraMetaProbe): number {
  if (r.kind === 'header') return HEADER_H
  if (r.kind === 'month') return MONTH_H
  if (r.kind === 'week') return WEEK_H
  if (r.kind === 'day-empty') return EMPTY_H
  if (r.kind === 'overdue-group') return OVERDUE_GROUP_H
  return (hasMetaRow(r, extraMeta) ? ROW_H_META : ROW_H_PLAIN) + (r.badge ? DAY_GAP_H : 0)
}
