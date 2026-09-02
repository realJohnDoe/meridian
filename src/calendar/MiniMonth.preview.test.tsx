// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import MiniMonth from './MiniMonth'
import { setupStore, seedStore, makeRoots } from '@/test-utils'

// MiniMonth's own carousel (see useCarousel) exists to keep Embla's snap
// animation uninterrupted — its pane-recentering state (`month`) is
// deliberately deferred to commit (settle), never preview (touchend), or the
// carousel would recenter mid-animation. Embla has no real drag physics
// under jsdom (no layout engine), so there's no way to actually trigger a
// swipe here — this test instead captures the onPreview/onCommit MiniMonth
// wires useCarousel with and drives them directly, to pin two invariants:
//
//   1. onPreview reports the browsed month via onBrowseMonthPreview (cheap,
//      decoupled preview state a caller can use instead of navigating —
//      see MiniMonth's own doc comment on that prop), never onBrowseMonth
//      itself, which is reserved for the real commit.
//   2. Even if anchorMonth changes for some unrelated reason while a swipe
//      is still in flight, the carousel must hold its own pane window at
//      the pre-swipe month rather than recentering mid-animation — see
//      MiniMonth's useResetOnChange guard.
interface CapturedCarouselOpts {
  unitKey: string
  onPreview: (key: string) => void
  onCommit: (key: string) => void
}

let latestOpts: CapturedCarouselOpts | undefined

vi.mock('./useCarousel', () => ({
  useCarousel: (opts: CapturedCarouselOpts) => {
    latestOpts = opts
    return { emblaRef: () => {}, paneKeys: [opts.unitKey] }
  },
}))

setupStore()

function Host({ anchorMonth, onBrowseMonth, onBrowseMonthPreview }: {
  anchorMonth: Date
  onBrowseMonth: (d: Date) => void
  onBrowseMonthPreview: (d: Date) => void
}) {
  return (
    <MiniMonth
      open
      anchorMonth={anchorMonth}
      highlightDates={[]}
      onSelectDay={() => {}}
      onBrowseMonth={onBrowseMonth}
      onBrowseMonthPreview={onBrowseMonthPreview}
    />
  )
}

describe("MiniMonth's swipe preview vs its carousel's own commit", () => {
  it('reports a browsed month via onBrowseMonthPreview on preview, never onBrowseMonth, and only recenters its own carousel on commit', () => {
    seedStore([], makeRoots('note.md'))
    const onBrowseMonth = vi.fn()
    const onBrowseMonthPreview = vi.fn()

    const { rerender } = render(
      <Host anchorMonth={new Date(2026, 7, 1)} onBrowseMonth={onBrowseMonth} onBrowseMonthPreview={onBrowseMonthPreview} />,
    )
    expect(latestOpts?.unitKey).toBe('2026-08')

    // The swipe's target locks in (touchend) — reported to the caller via
    // the cheap preview callback right away, and MonthStrip's own highlight
    // (fixed separately) already reflects it too. onBrowseMonth (which a
    // caller wires to a real navigation — see _app.tsx) must not fire yet.
    act(() => latestOpts?.onPreview('2026-09'))
    expect(onBrowseMonthPreview).toHaveBeenCalledExactlyOnceWith(new Date(2026, 8, 1))
    expect(onBrowseMonth).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-current', 'date')

    // anchorMonth changes for some unrelated reason while the swipe is still
    // in flight (e.g. a preview from elsewhere echoing back, or any other
    // cause) — the carousel itself must hold at August, or it would
    // recenter mid-swipe.
    rerender(
      <Host anchorMonth={new Date(2026, 8, 1)} onBrowseMonth={onBrowseMonth} onBrowseMonthPreview={onBrowseMonthPreview} />,
    )
    expect(latestOpts?.unitKey).toBe('2026-08')

    // Only the real commit (settle) moves it — and only then does
    // onBrowseMonth (the real navigation) fire.
    act(() => latestOpts?.onCommit('2026-09'))
    expect(latestOpts?.unitKey).toBe('2026-09')
    expect(onBrowseMonth).toHaveBeenCalledExactlyOnceWith(new Date(2026, 8, 1))
  })
})
