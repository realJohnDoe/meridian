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
// wires useCarousel with and drives them directly, to pin the invariant
// added alongside onPreview reporting the browsed month early: the caller's
// own navigation (onBrowseMonth) can echo straight back as a new
// anchorMonth before the swipe settles, and that echo must not be allowed
// to recenter the carousel ahead of the real commit — see MiniMonth's own
// useResetOnChange guard.
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
  it('reports a browsed month to the caller on preview, but only recenters its own carousel on commit — an echoed anchorMonth in between must not jump the gun', () => {
    seedStore([], makeRoots('note.md'))
    const onBrowseMonth = vi.fn()

    const { rerender } = render(<Host anchorMonth={new Date(2026, 7, 1)} onBrowseMonth={onBrowseMonth} />)
    expect(latestOpts?.unitKey).toBe('2026-08')

    // The swipe's target locks in (touchend) — reported to the caller right
    // away, and MonthStrip's own highlight (fixed separately) already
    // reflects it too.
    act(() => latestOpts?.onPreview('2026-09'))
    expect(onBrowseMonth).toHaveBeenCalledExactlyOnceWith(new Date(2026, 8, 1))
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-current', 'date')

    // The caller's navigation (onBrowseMonth above) echoes straight back as
    // a new anchorMonth before the swipe has actually settled — the
    // carousel itself must hold at August, or it would recenter mid-swipe.
    rerender(<Host anchorMonth={new Date(2026, 8, 1)} onBrowseMonth={onBrowseMonth} />)
    expect(latestOpts?.unitKey).toBe('2026-08')

    // Only the real commit (settle) moves it.
    act(() => latestOpts?.onCommit('2026-09'))
    expect(latestOpts?.unitKey).toBe('2026-09')
  })
})
