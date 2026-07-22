// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OccurrenceCard from './OccurrenceCard'
import { setupStore, makeOcc } from '@/test-utils'
import { fmtShort } from '@/format'
import { parseDateString } from '@/model'

setupStore()

describe('OccurrenceCard', () => {
  describe('leading slot', () => {
    it('leadingIcon="checkbox" shows a checkbox for a trackable occurrence', () => {
      const occ = makeOcc({ metadata: { participants: [], title: 'Task', tags: [], items: [], done: false } })
      render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="checkbox" />)
      expect(screen.getByRole('checkbox')).toBeInTheDocument()
    })

    it('leadingIcon="checkbox" shows nothing for a non-trackable occurrence', () => {
      const occ = makeOcc() // metadata.done undefined -> not trackable
      const { container } = render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="checkbox" />)
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(container.querySelector('.lucide-calendar-days, .lucide-file-text, .lucide-square-check-big')).not.toBeInTheDocument()
    })

    it('leadingIcon="kind" always shows KindIcon, even for a trackable occurrence', () => {
      const occ = makeOcc({ metadata: { participants: [], title: 'Task', tags: [], items: [], done: false } })
      const { container } = render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" />)
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(container.querySelector('.lucide-square-check-big')).toBeInTheDocument()
    })

    it('leadingIcon="both" shows the checkbox for a trackable occurrence', () => {
      const occ = makeOcc({ metadata: { participants: [], title: 'Task', tags: [], items: [], done: false } })
      render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="both" />)
      expect(screen.getByRole('checkbox')).toBeInTheDocument()
    })

    it('leadingIcon="both" falls back to KindIcon for a non-trackable occurrence', () => {
      const occ = makeOcc() // no `done` field -> event
      const { container } = render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="both" />)
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(container.querySelector('.lucide-calendar-days')).toBeInTheDocument()
    })
  })

  describe('done / dimmed state', () => {
    it('strike-throughs the title and shows the done overlay when metadata.done is true', () => {
      const occ = makeOcc({ metadata: { participants: [], title: 'Done Task', tags: [], items: [], done: true } })
      const { container } = render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="checkbox" />)
      expect(screen.getByText('Done Task')).toHaveClass('line-through')
      expect(container.querySelector('[style*="done-overlay"]')).toBeInTheDocument()
    })

    it('shows the done overlay (but not strike-through) for a past, non-done event', () => {
      const now = new Date('2026-06-16T12:00:00')
      const occ = makeOcc({
        date: '2026-06-15',
        time: '09:00',
        metadata: { participants: [], title: 'Past Event', tags: [], items: [], jsTime: new Date('2026-06-15T09:00:00') },
      })
      const { container } = render(<OccurrenceCard occ={occ} now={now} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" />)
      expect(screen.getByText('Past Event')).not.toHaveClass('line-through')
      expect(container.querySelector('[style*="done-overlay"]')).toBeInTheDocument()
    })

    it('shows neither strike-through nor the done overlay for an open, non-past occurrence', () => {
      const occ = makeOcc({ metadata: { participants: [], title: 'Open Task', tags: [], items: [], done: false } })
      const { container } = render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="checkbox" />)
      expect(screen.getByText('Open Task')).not.toHaveClass('line-through')
      expect(container.querySelector('[style*="done-overlay"]')).not.toBeInTheDocument()
    })
  })

  describe('recurrence icon', () => {
    it('shows the recurrence icon only when the occurrence has an ownerId', () => {
      const standalone = makeOcc({ id: 'a' })
      const { container, rerender } = render(<OccurrenceCard occ={standalone} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" />)
      expect(container.querySelector('.lucide-repeat-2')).not.toBeInTheDocument()

      const recurring = makeOcc({ id: 'b', ownerId: 'series-1' })
      rerender(<OccurrenceCard occ={recurring} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" />)
      expect(container.querySelector('.lucide-repeat-2')).toBeInTheDocument()
    })
  })

  describe('meta row', () => {
    it('renders no meta row when there is nothing to show', () => {
      const occ = makeOcc({ time: '', metadata: { participants: [], title: 'Bare', tags: [], items: [] } })
      const { container } = render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" showTagsParticipants={false} />)
      expect(screen.getByText('Bare')).toBeInTheDocument()
      // No time/date/duration/tags configured, and participants are hidden -> no meta badges at all
      // (both Badge variants used in the meta row share the `text-2xs` size class).
      expect(container.querySelectorAll('.text-2xs').length).toBe(0)
    })

    it('shows a date badge computed via fmtShort when showDate is true', () => {
      const occ = makeOcc({ date: '2026-06-15' })
      render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" showDate />)
      const expected = fmtShort(parseDateString('2026-06-15')!)
      expect(screen.getByText(expected)).toBeInTheDocument()
    })

    it('shows an inline time chip in the meta row when showTime="badge"', () => {
      const occ = makeOcc({ time: '09:00' })
      render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" showTime="badge" />)
      expect(screen.getByText('09:00')).toBeInTheDocument()
    })

    it('hides the time chip when showTime="none"', () => {
      const occ = makeOcc({ time: '09:00' })
      render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" showTime="none" />)
      expect(screen.queryByText('09:00')).not.toBeInTheDocument()
    })

    it('shows a formatted duration chip when a duration is set and no time is scheduled', () => {
      const occ = makeOcc({ time: '', metadata: { participants: [], title: 'Standup', tags: [], items: [], duration: '90 minutes' } })
      render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" />)
      expect(screen.getByText('1 hour, 30 minutes')).toBeInTheDocument()
    })

    it('renders listedOn entries as topic chips when showTagsParticipants is true', () => {
      const occ = makeOcc()
      render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" listedOn={['Project X']} />)
      expect(screen.getByText('Project X')).toBeInTheDocument()
    })
  })

  describe('participants', () => {
    it('shows initials for up to 3 participants and a +N overflow badge beyond that', () => {
      const occ = makeOcc({
        metadata: { participants: ['Alice', 'Bob', 'Carol', 'Dave'], title: 'Standup', tags: [], items: [] },
      })
      const { container } = render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" />)
      expect(container.querySelector('[title="Alice"]')).toBeInTheDocument()
      expect(container.querySelector('[title="Bob"]')).toBeInTheDocument()
      expect(container.querySelector('[title="Carol"]')).toBeInTheDocument()
      expect(container.querySelector('[title="Dave"]')).not.toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
    })

    it('hides participant avatars and listed-on chips when showTagsParticipants is false', () => {
      const occ = makeOcc({ metadata: { participants: ['Alice'], title: 'Standup', tags: [], items: [] } })
      const { container } = render(
        <OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={vi.fn()} leadingIcon="kind" listedOn={['Project X']} showTagsParticipants={false} />,
      )
      expect(container.querySelector('[title="Alice"]')).not.toBeInTheDocument()
      expect(screen.queryByText('Project X')).not.toBeInTheDocument()
    })
  })

  describe('interaction', () => {
    it('calls onOpen when the card surface is clicked', () => {
      const onOpen = vi.fn()
      const occ = makeOcc()
      render(<OccurrenceCard occ={occ} onOpen={onOpen} onToggleDone={vi.fn()} leadingIcon="kind" />)
      fireEvent.click(screen.getByRole('button', { name: occ.metadata.title }))
      expect(onOpen).toHaveBeenCalledTimes(1)
    })

    it('calls onToggleDone and optimistically checks the box when clicked', () => {
      const onToggleDone = vi.fn()
      const occ = makeOcc({ metadata: { participants: [], title: 'Task', tags: [], items: [], done: false } })
      render(<OccurrenceCard occ={occ} onOpen={vi.fn()} onToggleDone={onToggleDone} leadingIcon="checkbox" />)
      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()

      fireEvent.click(checkbox)

      expect(onToggleDone).toHaveBeenCalledTimes(1)
      expect(checkbox).toBeChecked()
    })
  })
})
