// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as ReactRouter from '@tanstack/react-router'
import { render, waitFor } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'

const { navigateMock, searchMock, historyKeyMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  searchMock: vi.fn<() => { title?: string }>(),
  historyKeyMock: vi.fn<() => string | undefined>(),
}))

// Same shape as auth.callback.test.tsx: createFileRoute is mocked so the page
// component is reachable without standing up a router.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouter: () => ({ history: { back: vi.fn() } }),
    // Runs the page's own selector, so the shape it reads (`location.state`)
    // is part of what this pins rather than an assumption.
    useRouterState: ({ select }: { select: (s: { location: { state: { __TSR_key?: string } } }) => unknown }) =>
      select({ location: { state: { __TSR_key: historyKeyMock() } } }),
    createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, useSearch: () => searchMock() }),
  }
})

setupStore()
installFakePersistence()

const { Route } = await import('./_entry.entry.new')
const NewEntryPage = (Route as unknown as { component: () => React.ReactElement }).component

const DRAFT_ID = 'history-entry-1'

beforeEach(() => {
  navigateMock.mockClear()
  searchMock.mockReturnValue({ title: 'Buy milk' })
  historyKeyMock.mockReturnValue(DRAFT_ID)
  useStore.setState({ vaultLoading: false })
})

describe('/entry/new', () => {
  it('creates the file for a draft the store has never seen', async () => {
    render(<NewEntryPage />)

    await waitFor(() => {
      expect([...useStore.getState().roots.keys()]).toEqual([testKey('buy-milk')])
    })
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('redirects to the file this draft already created instead of creating a second one', async () => {
    // The reported bug: coming back to /entry/new (Back, or a reload) remounted
    // the editor, which no longer recognised the file its first visit had made
    // and created `buy-milk-2` beside it — carrying the title, but none of the
    // edits that had landed on the first.
    const occ = makeOcc({ id: DRAFT_ID, entryKey: testKey('buy-milk'), metadata: { vaultId: TEST_VAULT, fileSlug: 'buy-milk', participants: [], title: 'Buy milk', tags: [], items: [], priority: 'high' } })
    seedStore([occ], makeRoots('buy-milk', { title: 'Buy milk' }))

    render(<NewEntryPage />)

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({
        params: { vault: TEST_VAULT, slug: 'buy-milk' },
        replace: true,
      }))
    })
    expect([...useStore.getState().roots.keys()]).toEqual([testKey('buy-milk')])
    const items = useStore.getState().items.filter(i => i.entryKey === testKey('buy-milk'))
    expect(items).toHaveLength(1)
    // The edits that landed on the first visit are still there — the resumed
    // session redirects to this file rather than writing a blank draft over it.
    expect((items[0]?.metadata as { priority?: string }).priority).toBe('high')
  })

  it('waits for the vaults to finish loading before creating anything', () => {
    useStore.setState({ vaultLoading: true })

    render(<NewEntryPage />)

    // Nothing created against a store that hasn't read every file yet: the
    // first save could otherwise take a slug an unparsed file already owns.
    expect([...useStore.getState().roots.keys()]).toEqual([])
  })
})
