// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeRoots } from '@/test-utils'
import type { Occurrence } from '@/types'
import { useEntryEditor } from './useEntryEditor'
import EditorShell from './EditorShell'

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

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function Harness({ occ }: { occ: Occurrence }) {
  const hooks = useEntryEditor(occ)
  return <EditorShell entry={hooks.entry} hooks={hooks} items={[occ]} roots={makeRoots(occ.fileSlug)} />
}

describe('EditorShell', () => {
  it('autosaves a body edit after the debounce and persists a checkbox toggle immediately', () => {
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md', metadata: { participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))
    render(<Harness occ={occ} />)

    fireEvent.change(screen.getByLabelText('body'), { target: { value: 'new body text' } })
    expect(persistence.writes).toEqual([]) // debounced, not yet committed

    act(() => { vi.advanceTimersByTime(1500) })

    expect(persistence.writes).toEqual(['note.md'])
    expect(useStore.getState().roots.get('note.md')?.body).toBe('new body text')

    fireEvent.click(screen.getByRole('checkbox'))

    expect(persistence.writes).toEqual(['note.md', 'note.md'])
    const saved = useStore.getState().items.find(i => i.id === 'occ-1') as { metadata: { done?: boolean } } | undefined
    expect(saved?.metadata.done).toBe(true)
  })
})
