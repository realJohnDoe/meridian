// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WeekPane from './WeekPane'
import { setupStore, seedStore, makeRoots, testKey } from '@/test-utils'
import type { StoreOcc } from '@/types'

setupStore()

// Mon 2026-06-08 … Sun 2026-06-14 (setupStore pins firstDayOfWeek to Monday).
const WEEK_START = '2026-06-08'

function multiday(id: string, date: string, duration: string): StoreOcc {
  return { id, date, time: null, source: 'explicit', entryKey: testKey('note.md'), metadata: { participants: [], duration } }
}

function renderWeek(items: StoreOcc[]) {
  seedStore(items, makeRoots('note.md'))
  return render(
    <WeekPane
      weekStartKey={WEEK_START}
      onOpen={() => {}}
      onDayClick={() => {}}
      registerScroller={() => {}}
      onVerticalScroll={() => {}}
      getInitialScrollTop={() => 0}
    />,
  )
}

/** The all-day bar's chevron, if any — OccurrencePill labels the bar with the occurrence title. */
function chevronOf(title: string): SVGElement | null {
  return screen.getByRole('button', { name: title }).querySelector('svg')
}

// Chevrons on week bars are deliberately NOT hidden below `sm:` the way
// MonthGrid's are — see renderBar in WeekPane. The one-column case is the
// regression these guard: it used to fall back to MonthGrid's `hidden sm:block`
// treatment, so a bar clipped to a single column showed no continuation cue on
// mobile at all, even though the day view showed one for the same event.
describe('WeekPane continuation chevrons', () => {
  it('shows a chevron at every width on a bar continuing past the week start', () => {
    // Fri 5th + 5 days -> Fri…Tue, so it covers Mon+Tue of this week.
    renderWeek([multiday('wide', '2026-06-05', '5 days')])
    expect(chevronOf('Note')?.getAttribute('class')).toContain('lucide-chevron-left')
    expect(chevronOf('Note')?.getAttribute('class')).not.toContain('hidden')
  })

  it('shows a chevron at every width on a one-column-wide bar continuing past the week start', () => {
    // Sun 7th + 2 days -> Sun+Mon, so it covers only Monday of this week.
    renderWeek([multiday('narrow', '2026-06-07', '2 days')])
    expect(chevronOf('Note')?.getAttribute('class')).toContain('lucide-chevron-left')
    expect(chevronOf('Note')?.getAttribute('class')).not.toContain('hidden')
  })

  it('shows a chevron at every width on a one-column-wide bar continuing past the week end', () => {
    // Sun 14th + 3 days -> Sun…Tue, so it covers only Sunday of this week.
    renderWeek([multiday('tail', '2026-06-14', '3 days')])
    expect(chevronOf('Note')?.getAttribute('class')).toContain('lucide-chevron-right')
    expect(chevronOf('Note')?.getAttribute('class')).not.toContain('hidden')
  })

  it('leaves a bar contained in the week without chevrons', () => {
    renderWeek([multiday('inside', '2026-06-09', '2 days')])
    expect(chevronOf('Note')).toBeNull()
  })
})
