import type { CSSProperties, ReactNode } from 'react'
import type { Virtualizer, VirtualItem } from '@tanstack/react-virtual'

interface VirtualRowsProps<T> {
  /** Wrapper classes — the one thing that varies between callers (max-width, padding). */
  className: string
  virtualizer: Virtualizer<HTMLDivElement, Element>
  rows: T[]
  /**
   * Extra style keys merged onto a row's positioned div, alongside the shared
   * position/transform (FileResultsList's `--stagger` and `paddingBottom`).
   * Most callers don't need this.
   */
  rowStyle?: (row: T, vi: VirtualItem) => CSSProperties
  renderRow: (row: T, vi: VirtualItem) => ReactNode
}

/**
 * The positioned-row scaffold every `useVirtualizer` caller needs: a
 * relative-height spacer sized to the virtualizer's total, and one
 * absolutely-positioned, translateY'd div per visible row, ref'd to
 * `measureElement` so a real measurement replaces the estimate.
 *
 * `renderRow` owns everything inside that div, including whether it nests a
 * further wrapper. AgendaView and OccurrenceList each nest one carrying
 * `useVirtualFlip`'s FLIP_KEY_ATTR: a WAAPI glide animation outranks inline
 * style, so animating the outer, positioned div here would override its own
 * translateY and stack every row at the top of the list. FileResultsList
 * doesn't animate and returns its row content directly.
 */
export function VirtualRows<T>({ className, virtualizer, rows, rowStyle, renderRow }: VirtualRowsProps<T>) {
  return (
    <div className={className}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vi => {
          const row = rows[vi.index]!
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
                ...rowStyle?.(row, vi),
              }}
            >
              {renderRow(row, vi)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
