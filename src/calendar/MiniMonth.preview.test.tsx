// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import MiniMonth from './MiniMonth'
import { setupStore, seedStore, makeRoots } from '@/test-utils'

// MiniMonth's own carousel (see useCarousel) exists to keep Embla's snap
// animation uninterrupted — its pane-recentering state (`month`) is
// deliberately deferred to commit (settle), never preview (touchend), or the
// carousel would recenter mid-animation. onBrowseMonth (the expensive part —
// it navigates the main view behind this panel) is deferred even further:
// it now only fires from the real commit, not from the early preview, since
// even wrapped in a transition it was still enough work (mounting a fresh
// Day/Week pane) to visibly stall this mini-grid's own snap animation — see
// MiniMonth's setMonth. Embla has no real drag physics under jsdom (no
// layout engine), so there's no way to actually trigger a swipe here — this
// test instead captures the onPreview/onCommit MiniMonth wires useCarousel
// with and drives them directly.
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

function Host({ anchorMonth, onBrowseMonth }: { anchorMonth: Date; onBrowseMonth: (d: Date) => void }) {
  return (
    <MiniMonth
      open
      anchorMonth={anchorMonth}
      highlightDates={[]}
      onSelectDay={() => {}}
      onBrowseMonth={onBrowseMonth}
    />
  )
}

describe("MiniMonth's swipe preview vs its carousel's own commit", () => {
  it('moves the highlight on preview without touching the caller, and only reports/recenters on commit', () => {
    seedStore([], makeRoots('note.md'))
    const onBrowseMonth = vi.fn()

    const { rerender } = render(<Host anchorMonth={new Date(2026, 7, 1)} onBrowseMonth={onBrowseMonth} />)
    expect(latestOpts?.unitKey).toBe('2026-08')

    // The swipe's target locks in (touchend) — MonthStrip's own highlight
    // tracks it right away, but the caller isn't told yet and the carousel
    // itself hasn't recentered: both would mean real work (a fresh Day/Week
    // pane) landing mid-animation.
    act(() => latestOpts?.onPreview('2026-09'))
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-current', 'date')
    expect(onBrowseMonth).not.toHaveBeenCalled()
    expect(latestOpts?.unitKey).toBe('2026-08')

    // An unrelated anchorMonth change while the preview is still in flight
    // (not our own echo — that no longer arrives until after settle) must
    // not yank the carousel out from under the gesture either.
    rerender(<Host anchorMonth={new Date(2026, 9, 1)} onBrowseMonth={onBrowseMonth} />)
    expect(latestOpts?.unitKey).toBe('2026-08')

    // Only the real commit (settle) moves the carousel and reports the
    // browsed month to the caller.
    act(() => latestOpts?.onCommit('2026-09'))
    expect(latestOpts?.unitKey).toBe('2026-09')
    expect(onBrowseMonth).toHaveBeenCalledExactlyOnceWith(new Date(2026, 8, 1))
  })
})
