// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { addDays, startOfToday } from 'date-fns'
import type * as ReactRouter from '@tanstack/react-router'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { applyEdit, expandRange, fmtISO, parseToStoreItems } from '@/model'
import { commitNext } from '@/storeCommit'
import { getSnapshot } from '@/storeBridge'
import { toggleOccDone } from '@/occurrenceActions'
import type { Occurrence } from '@/types'
import type { EditFields } from '@/model'
import type { VaultRef } from '@/vaultRef'

const { navigateMock, backMock, paramsMock, searchMock, handleDelete, handleClose, editorGot } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  backMock:     vi.fn(),
  paramsMock:   vi.fn<() => { vault: string; slug: string }>(),
  searchMock:   vi.fn<() => { date?: string; scope?: string; id?: string }>(),
  handleDelete: vi.fn(),
  handleClose:  vi.fn(),
  editorGot:    { occ: null as Occurrence | null },
}))

// createFileRoute is mocked so the page component is reachable without a real
// router tree — Route.useParams()/useSearch() need live router context
// otherwise, same approach as auth.callback.test.tsx.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const [actual, { navigateStub }] = await Promise.all([importOriginal<typeof ReactRouter>(), import('@/test-utils/router')])
  return {
    ...actual,
    ...navigateStub({ navigate: navigateMock, back: backMock }),
    createFileRoute: () => (opts: Record<string, unknown>) => ({
      ...opts,
      useParams: () => paramsMock(),
      useSearch: () => searchMock(),
    }),
  }
})

// useEntryEditor pulls in autosave/CodeMirror machinery covered by its own
// suite (useEntryEditor.test.tsx, EntryEditor.test.tsx); this route's own job
// is resolving the occurrence and picking editable vs view-only, so the
// editor implementations are stood in for markers naming what they received.
// EntryEditor itself is handed `items` (the *whole* store, for wikilink
// resolution) rather than the one resolved occurrence — that only reaches it
// via `hooks`, threaded through from `useEntryEditor(occ, scope)`'s first
// argument, so the stub has to read it from there rather than from `items[0]`.
vi.mock('@/editor', () => ({
  useEntryEditor: (occ: Occurrence) => { editorGot.occ = occ; return { handleDelete, handleClose, occ } },
  EntryEditor:   ({ hooks }: { hooks: { occ: { date: string; metadata: { title: string } } } }) => <div data-testid="editor" data-date={hooks.occ.date}>{hooks.occ.metadata.title}</div>,
  EntryViewOnly: ({ occ }: { occ: { metadata: { title: string } } }) => <div data-testid="view-only">{occ.metadata.title}</div>,
}))

// A collaborator, not the subject: SyncButton drags in the whole sync/store stack.
vi.mock('@/components', () => ({ SyncButton: () => <div data-testid="sync-button" /> }))

setupStore()
installFakePersistence()

const { Route } = await import('./_entry.entry.$vault.$slug')
const EntrySlugPage = (Route as unknown as { component: () => React.ReactElement }).component

const LOCAL_VAULT: VaultRef = { id: TEST_VAULT, name: 'Notes', kind: 'local' }
const ICAL_VAULT: VaultRef = { id: TEST_VAULT, name: 'Family calendar', kind: 'ical', ical: { url: 'https://example.com/cal.ics' } }

beforeEach(() => {
  navigateMock.mockClear()
  backMock.mockClear()
  handleDelete.mockClear()
  handleClose.mockClear()
  paramsMock.mockReturnValue({ vault: TEST_VAULT, slug: 'note.md' })
  searchMock.mockReturnValue({})
  useStore.setState({ vaults: [LOCAL_VAULT] })
})

describe('_entry/entry/$vault/$slug — loading and not-found', () => {
  it('shows a loading skeleton while vaults are still loading and nothing has resolved', () => {
    useStore.setState({ vaultLoading: true })
    const { container } = render(<EntrySlugPage />)

    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByText('Item not found.')).not.toBeInTheDocument()
  })

  it('shows a not-found state once loading has finished and no occurrence resolves', () => {
    useStore.setState({ vaultLoading: false })
    render(<EntrySlugPage />)

    expect(screen.getByText('Item not found.')).toBeInTheDocument()
  })

  it('navigates to the agenda from the not-found state\'s back button', () => {
    useStore.setState({ vaultLoading: false })
    render(<EntrySlugPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to agenda' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
  })
})

describe('_entry/entry/$vault/$slug — URL to occurrence resolution', () => {
  // EntryEditor/EntryViewOnly are lazy-loaded behind a Suspense boundary (see
  // #6's "second trap"): the first render commits the EntrySkeleton
  // fallback, and only a later microtask swaps in the mocked component — a
  // synchronous getByTestId right after render would still be looking at the
  // fallback and pass for the wrong reason. findByTestId awaits that swap.
  it('resolves from the file map when no date is pinned', async () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Plain note' } })
    seedStore([occ], makeRoots('note.md', { title: 'Plain note' }))

    render(<EntrySlugPage />)
    expect(await screen.findByTestId('editor')).toHaveTextContent('Plain note')
  })

  it('picks the occurrence matching the pinned date and id, when two occurrences share a date', async () => {
    const occA = makeOcc({ id: 'occ-a', date: '2026-06-15', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'First' } })
    const occB = makeOcc({ id: 'occ-b', date: '2026-06-15', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Second' } })
    seedStore([occA, occB], makeRoots('note.md'))
    searchMock.mockReturnValue({ date: '2026-06-15', id: 'occ-b' })

    render(<EntrySlugPage />)
    expect(await screen.findByTestId('editor')).toHaveTextContent('Second')
  })

  it('falls back to the first candidate on that date when id is absent (older links)', async () => {
    const occA = makeOcc({ id: 'occ-a', date: '2026-06-15', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'First' } })
    const occB = makeOcc({ id: 'occ-b', date: '2026-06-15', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Second' } })
    seedStore([occA, occB], makeRoots('note.md'))
    searchMock.mockReturnValue({ date: '2026-06-15' })

    render(<EntrySlugPage />)
    expect(await screen.findByTestId('editor')).toHaveTextContent('First')
  })

  it('falls back to the file map when the pinned date has no matching candidate', async () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Plain note' } })
    seedStore([occ], makeRoots('note.md'))
    searchMock.mockReturnValue({ date: '2099-01-01' })

    render(<EntrySlugPage />)
    expect(await screen.findByTestId('editor')).toHaveTextContent('Plain note')
  })
})

describe('_entry/entry/$vault/$slug — editable vs view-only branch', () => {
  it('renders the editable editor for a writable vault', async () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Plain note' } })
    seedStore([occ], makeRoots('note.md'))
    useStore.setState({ vaults: [LOCAL_VAULT] })

    render(<EntrySlugPage />)
    expect(await screen.findByTestId('editor')).toBeInTheDocument()
    expect(screen.queryByTestId('view-only')).not.toBeInTheDocument()
  })

  it('renders the read-only view for a vault with no write access', async () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Family event' } })
    seedStore([occ], makeRoots('note.md'))
    useStore.setState({ vaults: [ICAL_VAULT] })

    render(<EntrySlugPage />)
    expect(await screen.findByTestId('view-only')).toHaveTextContent('Family event')
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })

  it('hides the delete action for a view-only entry', async () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Family event' } })
    seedStore([occ], makeRoots('note.md'))
    useStore.setState({ vaults: [ICAL_VAULT] })

    render(<EntrySlugPage />)
    await screen.findByTestId('view-only')
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('wires the editable topbar\'s back/delete buttons to the editor hooks', () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Plain note' } })
    seedStore([occ], makeRoots('note.md'))
    useStore.setState({ vaults: [LOCAL_VAULT] })

    render(<EntrySlugPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(handleDelete).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('toggles the favorite flag in the store from either branch\'s topbar', () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Plain note' } })
    seedStore([occ], makeRoots('note.md'))
    useStore.setState({ vaults: [LOCAL_VAULT] })

    render(<EntrySlugPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }))
    expect(useStore.getState().favorites).toContain(testKey('note.md'))
  })
})

describe('_entry/entry/$vault/$slug — view-only back navigation', () => {
  function seedIcalEntry() {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Family event' } })
    seedStore([occ], makeRoots('note.md'))
    useStore.setState({ vaults: [ICAL_VAULT] })
  }

  it('goes back through router history when there is somewhere to go back to', () => {
    Object.defineProperty(window.history, 'length', { value: 2, configurable: true })
    seedIcalEntry()

    render(<EntrySlugPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(backMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('navigates to the agenda when there is no history to go back to', () => {
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true })
    seedIcalEntry()

    render(<EntrySlugPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
    expect(backMock).not.toHaveBeenCalled()
  })
})


describe('_entry/entry/$vault/$slug — the open occurrence stays the one that was opened', () => {
  // A weekly task a few days out, so the file's representative occurrence —
  // what a date-less URL resolves to — is its first one.
  const first = addDays(startOfToday(), 3)
  const week = (n: number) => fmtISO(addDays(first, 7 * n))

  function seedWeekly() {
    const parsed = parseToStoreItems('note.md.md', `---\ntitle: Weekly\ndone: false\ndate: ${week(0)}\nrepeat:\n  type: schedule\n  freq: weekly\n---\n`, TEST_VAULT)
    seedStore(parsed.items, new Map([[parsed.key, parsed.root]]))
  }
  const editorOcc = () => editorGot.occ!
  const occOn = (date: string) => expandRange(useStore.getState().items, useStore.getState().roots, new Date(date + 'T00:00:00'), new Date(date + 'T23:59:59'))[0]!

  /** The editor's date picker, at 'single' scope. */
  function moveTo(occ: Occurrence, date: string) {
    const m = occ.metadata
    const fields: EditFields = {
      title: m.title, body: m.body ?? '', tags: m.tags, items: m.items, participants: m.participants,
      tracked: true, done: m.done ?? false, priority: null, duration: '', repeat: null,
      scheduled: { date, time: '' },
    }
    commitNext(applyEdit(getSnapshot(), occ, 'single', fields, { vaultId: TEST_VAULT }), [occ.entryKey])
  }

  // Opened from a favorite or a wikilink, the URL names no date and resolves
  // to the earliest open occurrence — which ticking it done just changed.
  it('ticking done on a date-less open keeps the editor on that occurrence', async () => {
    seedWeekly()
    render(<EntrySlugPage />)
    await screen.findByTestId('editor')
    expect(editorOcc().date).toBe(week(0))

    act(() => { toggleOccDone(editorOcc()) })

    expect(editorOcc().date).toBe(week(0))
    expect(editorOcc().metadata.done).toBe(true)
  })

  it('follows an occurrence the editor moves, rather than staying on the emptied date', async () => {
    seedWeekly()
    const opened = occOn(week(1))
    searchMock.mockReturnValue({ date: opened.date, id: opened.id })
    render(<EntrySlugPage />)
    await screen.findByTestId('editor')

    const moved = fmtISO(addDays(first, 9))
    act(() => { moveTo(editorOcc(), moved) })
    expect(editorOcc().date).toBe(moved)

    act(() => { toggleOccDone(editorOcc()) })
    expect(occOn(moved).metadata.done).toBe(true)
    expect(occOn(week(0)).metadata.done).toBe(false)
  })

  // Back from a wikilink lands on the URL the occurrence was opened under,
  // whose date it has since left.
  it('resolves a URL by id when the occurrence has moved off the URL\'s date', async () => {
    seedWeekly()
    const opened = occOn(week(1))
    const moved = fmtISO(addDays(first, 9))
    moveTo(opened, moved)
    searchMock.mockReturnValue({ date: opened.date, id: opened.id })

    render(<EntrySlugPage />)
    await screen.findByTestId('editor')
    expect(editorOcc().date).toBe(moved)
  })
})
