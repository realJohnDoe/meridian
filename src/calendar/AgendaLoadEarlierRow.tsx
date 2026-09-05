import { memo } from 'react'
import { Button } from '@/components/primitives/button'

interface Props {
  onClick: () => void
}

/**
 * The agenda's backward-growth affordance — a plain control above the
 * scroller, not a virtualized row. Backward growth is deliberately a button
 * rather than a scroll trigger: auto-loading earlier content while the user
 * is dragging toward the top of the list would look like a teleport (see
 * useAnchoredAgendaScroll's touchingRef guard).
 *
 * Prepending a chunk changes `rows`' identity, which useAnchoredAgendaScroll
 * already reacts to — this component only has to trigger the growth, not hold
 * the scroll position steady while it happens.
 *
 * AgendaView only mounts this while the scroller sits at offset 0, so it
 * reads as the top of the list rather than a bar pinned above it regardless
 * of scroll position — no border of its own separating it from the row below.
 */
function AgendaLoadEarlierRow({ onClick }: Props) {
  return (
    <div className="flex shrink-0 justify-center bg-background pt-3">
      <Button type="button" variant="outline" onClick={onClick}>
        Load earlier
      </Button>
    </div>
  )
}

export default memo(AgendaLoadEarlierRow)
