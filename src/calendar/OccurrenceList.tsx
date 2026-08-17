import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown } from 'lucide-react'
import type { Occurrence, EditScope } from '@/types'
import { cn } from '@/lib/cn'
import AgendaRow from './AgendaRow'
import { useVirtualFlip, FLIP_KEY_ATTR } from './useVirtualFlip'

/**
 * One virtualizable row of an undated list — an occurrence, or the single
 * "Done · N" divider that separates the active rows from the completed ones.
 *
 * Flat on purpose. The Done group used to be a Radix `Collapsible` wrapping
 * its own `.map()`, which can't coexist with a virtualizer: the rows inside a
 * `CollapsibleContent` are laid out by that component, not by the virtualizer,
 * so they'd all mount at once the moment the section opened — the exact
 * failure this list is being restructured to avoid. Expanding the group
 * instead appends its rows to this one list, so open or closed it stays a
 * windowed render.
 */
type ListRow =
  | { kind: 'occ'; key: string; occ: Occurrence }
  | { kind: 'done-header'; key: string; count: number }

const DONE_HEADER_KEY = '__done__'

// Size estimates for the virtualizer. Real sizes are measured after render
// (measureElement); accurate estimates just keep the scrollbar stable before a
// row has been measured. Update these if the card/divider padding changes.
//
// ROW_H:     OccurrenceCard min-h-11 (44) + AgendaRow mb-1.5 (6) = 50px.
//            Undated occurrences carry no time, duration or date badge, so the
//            card's meta row only appears for an entry with backlinks (~68px).
//            Those are the minority here, so estimate the bare row and let
//            measurement correct the rest.
// DONE_H:    the "Done · N" button — mt-2 (8) + text-xs line (16) + mb-1 (4).
const ROW_H = 50
const DONE_HEADER_H = 28

interface Props {
  // Pre-sorted occurrences. Done items are split out into a collapsible section;
  // if there are none (e.g. notes), the section is omitted entirely.
  occs:          Occurrence[]
  onOpen:        (occ: Occurrence, scope?: EditScope) => void
  onToggleDone:  (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

/**
 * The undated lists (backlog, notes), virtualized row by row.
 *
 * Backlog is by definition where undated tasks pile up without a bound, so it
 * gets the same treatment AgendaView's overdue section got: `count` is the
 * flat row list, not a section count, and only the viewport plus overscan is
 * ever mounted. Each AgendaRow attaches three raw touch listeners and two
 * store subscriptions, so mounting a whole vault's worth in one synchronous
 * commit is what froze the agenda before it was virtualized.
 *
 * Row glides come from `useVirtualFlip`, not `FlipList`. FlipList measures the
 * list box itself and animates `transform` — the property the virtualizer
 * writes to position each row — so the two actively fight; its own doc comment
 * rules out using it inside a virtualizer. `useVirtualFlip` derives the same
 * glide from `VirtualItem.start` deltas instead, on the same duration/easing,
 * so a completed or deleted row moves exactly as it does in the non-virtual
 * lists (ItemsList, Sidebar).
 *
 * Owns its scroll container rather than taking a ref from the caller: React
 * runs a descendant's layout effects *before* an ancestor host element's ref
 * is attached, so a parent-owned ref reads null on the first commit and the
 * virtualizer silently never subscribes (see FileResultsList, which only gets
 * away with it because the search overlay always mounts empty).
 */
export default function OccurrenceList({ occs, onOpen, onToggleDone, onSwipeDelete }: Props) {
  'use no memo' // TanStack Virtual's useVirtualizer() reads mutable internal
  // state (scroll offset, measured sizes) through imperative methods rather
  // than props/state the compiler can track — react-hooks/incompatible-library.
  // The compiler already auto-skips this function for that reason, so the
  // directive is explicit documentation rather than a behaviour change; the
  // eslint warning here is expected and permanent, see eslint.config.js.
  // It does mean `rows` below needs a real useMemo — see there.
  const scRef = useRef<HTMLDivElement>(null)
  const [doneOpen, setDoneOpen] = useState(false)

  // Explicit useMemo, not compiler-inferred: this component is opted out
  // above, and useVirtualFlip keys its glide on `rows` identity — rebuilding
  // the array every render would tell it the data changed on every render.
  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = []
    const done: Occurrence[] = []
    for (const o of occs) {
      if (o.metadata.done) done.push(o)
      else out.push({ kind: 'occ', key: o.id, occ: o })
    }
    if (!done.length) return out
    out.push({ kind: 'done-header', key: DONE_HEADER_KEY, count: done.length })
    if (doneOpen) for (const o of done) out.push({ kind: 'occ', key: o.id, occ: o })
    return out
  }, [occs, doneOpen])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer() returns functions the compiler can't memoize safely; it correctly skips optimizing this component instead.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scRef.current,
    // `count` is rows.length, so the virtualizer only ever asks for i in range.
    estimateSize: i => rows[i]!.kind === 'done-header' ? DONE_HEADER_H : ROW_H,
    getItemKey: i => rows[i]!.key,
    overscan: 8,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Glide rows between positions when the list's contents change (a task
  // completed, deleted, the Done group opened). Keyed on `rows` identity, so
  // scrolling — which shifts `start` as unmeasured rows get measured — doesn't
  // animate.
  useVirtualFlip(scRef, virtualItems, rows, virtualizer.isScrolling)

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]" ref={scRef}>
      <div className="pt-2 pb-24 lg:max-w-3xl lg:mx-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualItems.map(vi => {
            // Same-render read: virtualItems came from this render's `rows`
            // (count === rows.length), so vi.index is in range.
            const row = rows[vi.index]!
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                {/* useVirtualFlip animates this inner element, never the
                    positioned one above: a WAAPI animation outranks inline
                    style, so gliding the outer div would override the
                    virtualizer's own translateY and stack every row at the
                    top of the list. */}
                <div {...{ [FLIP_KEY_ATTR]: vi.key }}>
                  {row.kind === 'done-header' ? (
                    <DoneHeaderRow
                      count={row.count}
                      open={doneOpen}
                      onToggle={() => setDoneOpen(o => !o)}
                    />
                  ) : (
                    <AgendaRow
                      occ={row.occ}
                      badge={{ kind: 'none' }}
                      onOpen={onOpen}
                      onToggleDone={onToggleDone}
                      onSwipeDelete={onSwipeDelete}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface DoneHeaderProps {
  count: number
  open: boolean
  onToggle: () => void
}

/**
 * The "Done · N" divider, as a plain toggle button.
 *
 * Replaces Radix's Collapsible trigger: the rows it used to reveal are now
 * part of the virtualized row list, so there is no single content region left
 * for `CollapsibleContent` to own (or for `aria-controls` to point at) —
 * `aria-expanded` carries the state on its own.
 */
function DoneHeaderRow({ count, open, onToggle }: DoneHeaderProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex items-center gap-1 mx-3.5 mt-2 mb-1 text-xs font-bold text-secondary-foreground tracking-[.08em] uppercase hover:text-foreground transition-colors"
    >
      <ChevronDown size={12} className={cn('transition-transform duration-200', open && 'rotate-180')} />
      Done · {count}
    </button>
  )
}
