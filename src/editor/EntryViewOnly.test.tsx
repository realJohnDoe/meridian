// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { useStore } from '@/store'
import { setupStore, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import EntryViewOnly from './EntryViewOnly'

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return { ...actual, useNavigate: () => navigateMock }
})

// CodeMirror can't mount in jsdom — stand in for the contract EntryViewOnly relies on.
vi.mock('./EntryBody', () => ({
  default: ({ body, readOnly, onOpenWikilink }: { body: string; readOnly?: boolean; onOpenWikilink?: (ref: string) => void }) => (
    <div data-testid="entry-body" data-readonly={String(!!readOnly)}>
      {body}
      <button onClick={() => onOpenWikilink?.('other-note')}>open-wikilink</button>
    </div>
  ),
}))

setupStore()

const VAULT: VaultRef = { id: TEST_VAULT, name: 'Family calendar', kind: 'ical', ical: { url: 'https://example.com/cal.ics' } }

beforeEach(() => {
  navigateMock.mockClear()
  useStore.setState({ vaults: [VAULT] })
})

describe('EntryViewOnly', () => {
  it('renders the title as static text, not an editable field', () => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Team sync', tags: [], items: [] } })
    render(<EntryViewOnly occ={occ} vault={VAULT} items={[occ]} roots={makeRoots('note.md')} />)

    expect(screen.getByText('Team sync')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows the vault as a source chip and date/time/duration/participant chips, always in long form', () => {
    // duration is stored short-form here on purpose — the UI must always render
    // the long form regardless of how the source vault (e.g. an iCal import)
    // spelled it on disk.
    const occ = makeOcc({
      date: '2026-06-15',
      time: '09:00',
      metadata: {
        vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Team sync', tags: [], items: [],
        participants: ['Alice', 'Bob'], duration: '30m',
      },
    })
    render(<EntryViewOnly occ={occ} vault={VAULT} items={[occ]} roots={makeRoots('note.md')} />)

    expect(screen.getByText('Family calendar')).toBeInTheDocument()
    expect(screen.getByText('09:00')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText(/30 minutes/)).toBeInTheDocument()
    expect(screen.queryByText(/30m\b/)).not.toBeInTheDocument()
  })

  it('renders location, url and organizer from extra, with url as a link', () => {
    const occ = makeOcc({
      metadata: {
        vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Team sync', tags: [], items: [], participants: [],
        extra: { location: 'Room 4B', url: 'https://meet.example.com/abc', organizer: 'Carol', uid: 'xyz' },
      },
    })
    render(<EntryViewOnly occ={occ} vault={VAULT} items={[occ]} roots={makeRoots('note.md')} />)

    expect(screen.getByText('Room 4B')).toBeInTheDocument()
    expect(screen.getByText('Carol')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /meet.example.com/ })
    expect(link).toHaveAttribute('href', 'https://meet.example.com/abc')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders attendees from extra, separately from participant chips', () => {
    const occ = makeOcc({
      metadata: {
        vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Team sync', tags: [], items: [],
        participants: ['Alice'],
        extra: { attendees: ['Alice', 'bob@example.com'], uid: 'xyz' },
      },
    })
    render(<EntryViewOnly occ={occ} vault={VAULT} items={[occ]} roots={makeRoots('note.md')} />)

    expect(screen.getAllByText('Alice')).toHaveLength(1) // participant chip only — attendees render as one joined line
    expect(screen.getByText(/Alice, bob@example\.com/)).toBeInTheDocument()
  })

  it('passes body through EntryBody as read-only', () => {
    const occ = makeOcc({
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Team sync', tags: [], items: [], participants: [], body: 'Agenda here' },
    })
    render(<EntryViewOnly occ={occ} vault={VAULT} items={[occ]} roots={makeRoots('note.md')} />)

    const body = screen.getByTestId('entry-body')
    expect(body).toHaveAttribute('data-readonly', 'true')
    expect(body).toHaveTextContent('Agenda here')
  })

  it('still resolves wikilink clicks within the entry\'s own vault', () => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Team sync', tags: [], items: [], participants: [] } })
    const roots = makeRoots('note.md')
    roots.set(testKey('other-note'), { title: 'Other', tags: [], items: [], vaultId: TEST_VAULT, fileSlug: 'other-note' })
    render(<EntryViewOnly occ={occ} vault={VAULT} items={[occ]} roots={roots} />)

    fireEvent.click(screen.getByText('open-wikilink'))

    expect(navigateMock).toHaveBeenCalledTimes(1)
    const arg = navigateMock.mock.calls[0]?.[0] as { params?: { vault: string; slug: string } }
    expect(arg.params).toEqual({ vault: TEST_VAULT, slug: 'other-note' })
  })
})
