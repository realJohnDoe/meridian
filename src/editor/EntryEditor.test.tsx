// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import type { Occurrence, Roots } from '@/types'
import { useEntryEditor } from './useEntryEditor'
import EntryEditor from './EntryEditor'

const { navigateMock, backMock } = vi.hoisted(() => ({ navigateMock: vi.fn(), backMock: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouter: () => ({ history: { back: backMock } }),
  }
})

// CodeMirror can't mount in jsdom — stand in a plain textarea wired to the same
// body/onChange contract EntryBody exposes to EntryEditor.
vi.mock('./EntryBody', () => ({
  default: ({ body, onChange }: { body: string; onChange?: (b: string) => void }) => (
    <textarea aria-label="body" defaultValue={body} onChange={(e) => onChange?.(e.target.value)} />
  ),
}))

setupStore()
const persistence = installFakePersistence()

// jsdom lays nothing out, so every rect is zeros — see ListedOnRow.test.tsx for why
// that reads as "scrolled out of view" and hides the floating picker entirely.
Element.prototype.getBoundingClientRect = () =>
  ({ x: 0, y: 100, top: 100, left: 0, right: 200, bottom: 130, width: 200, height: 30, toJSON: () => ({}) })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function Harness({ occ }: { occ: Occurrence }) {
  const hooks = useEntryEditor(occ)
  return <EntryEditor hooks={hooks} items={[occ]} roots={makeRoots(occ.entryKey)} />
}

describe('EntryEditor', () => {
  it('autosaves a body edit after the debounce and persists a checkbox toggle immediately', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))
    render(<Harness occ={occ} />)

    fireEvent.change(screen.getByLabelText('body'), { target: { value: 'new body text' } })
    expect(persistence.writes).toEqual([]) // debounced, not yet committed

    act(() => { vi.advanceTimersByTime(1500) })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('new body text')

    fireEvent.click(screen.getByRole('checkbox'))

    expect(persistence.writes).toEqual([testKey('note.md'), testKey('note.md')])
    const saved = useStore.getState().items.find(i => i.id === 'occ-1') as { metadata: { done?: boolean } } | undefined
    expect(saved?.metadata.done).toBe(true)
  })
})

// Reproduces the reported bug: adding a brand-new, never-saved entry straight to
// a list showed that list's chip twice. `handleAddLink` writes the link directly
// (since Save/Back flush nothing when no autosave is pending — see
// useEntryEditor.test.tsx's "listed on" suite) *and* leaves the pick sitting in
// `pendingLinks.pendingKeys`; once the store's `backlinks` index catches up with
// that same write, the list showed up from both sources at once.
describe('EntryEditor — listed on', () => {
  function NewEntryHarness() {
    const hooks = useEntryEditor(null, 'all', 'Buy milk')
    return <EntryEditor hooks={hooks} items={[]} roots={useStore.getState().roots} />
  }

  it('does not duplicate the chip for a list a brand-new entry was added to', () => {
    seedStore([], makeRoots('groceries', { title: 'Groceries' }))
    render(<NewEntryHarness />)

    fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
    fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'Groceries' } })
    fireEvent.click(screen.getByText('Groceries').closest('[cmdk-item]')!)

    expect(useStore.getState().roots.get(testKey('groceries'))?.items).toEqual(['[[buy-milk]]'])
    expect(screen.getAllByText('Groceries')).toHaveLength(1)
  })
})

// plans/archived-entries.md PR 2. A local harness rather than `Harness` above:
// this one's `roots` prop is keyed correctly on the occurrence's own entryKey
// (Harness's `makeRoots(occ.entryKey)` re-wraps an already-vault-qualified key
// as if it were a bare slug, so `roots.get(effectiveKey)` on it never resolves
// — harmless for the one test that uses it today, since that test never reads
// per-entry root fields off the `roots` prop, but wrong for this one, which is
// exactly that lookup.
describe('EntryEditor — archived banner', () => {
  function ArchiveHarness({ occ, roots }: { occ: Occurrence; roots: Roots }) {
    const hooks = useEntryEditor(occ)
    return <EntryEditor hooks={hooks} items={[occ]} roots={roots} />
  }

  function archivedRoots(occ: Occurrence, title: string, archived: boolean): Roots {
    const { vaultId, fileSlug } = occ.metadata
    return new Map([[occ.entryKey, { title, tags: [], items: [], vaultId, fileSlug, ...(archived ? { archived: true } : {}) }]])
  }

  it('shows the archived banner with an Unarchive action', () => {
    const occ = makeOcc({ id: 'occ-arch', entryKey: testKey('old-task.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'old-task.md', participants: [], title: 'Old Task', tags: [], items: [] } })
    seedStore([occ], makeRoots('old-task.md', { archived: true }))

    render(<ArchiveHarness occ={occ} roots={archivedRoots(occ, 'Old Task', true)} />)

    expect(screen.getByText(/archived/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument()
  })

  it('shows no banner for an ordinary, unarchived entry', () => {
    const occ = makeOcc({ id: 'occ-plain', entryKey: testKey('plain-task.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'plain-task.md', participants: [], title: 'Plain Task', tags: [], items: [] } })
    seedStore([occ], makeRoots('plain-task.md'))

    render(<ArchiveHarness occ={occ} roots={archivedRoots(occ, 'Plain Task', false)} />)

    expect(screen.queryByRole('button', { name: 'Unarchive' })).not.toBeInTheDocument()
  })

  it('clicking Unarchive clears the flag in the store', () => {
    const occ = makeOcc({ id: 'occ-unarch', entryKey: testKey('unarchive-me.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'unarchive-me.md', participants: [], title: 'Coming Back', tags: [], items: [] } })
    seedStore([occ], makeRoots('unarchive-me.md', { archived: true }))

    render(<ArchiveHarness occ={occ} roots={archivedRoots(occ, 'Coming Back', true)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }))

    expect(useStore.getState().roots.get(testKey('unarchive-me.md'))?.archived).toBeUndefined()
  })
})
