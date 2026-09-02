// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ItemsList, { rowSortKey } from './ItemsList'
import { parseItemEntry } from './items'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeSeries, makeRoots, testKey, makeRootMeta, TEST_VAULT } from '@/test-utils'
import { toggleOccDone } from '@/occurrenceActions'
import { useStore } from '@/store'
import type { Occurrence, Roots, StoreOcc } from '@/types'

setupStore()
const persistence = installFakePersistence()

// jsdom lays nothing out, so every rect is zeros — and a zero-height anchor
// resting on the top of the usable band reads as "scrolled out of view",
// which makes useFloatingCombobox measure no placement and the portaled
// list render nothing at all (see computeFloatingPlacement). One plausible
// rect is enough to put the picker's suggestion list on screen.
Element.prototype.getBoundingClientRect = () =>
  ({ x: 0, y: 100, top: 100, left: 0, right: 200, bottom: 130, width: 200, height: 30, toJSON: () => ({}) })

// jsdom implements no Web Animations API. FlipList reaches for it whenever a
// row moves or enters, so a harmless stub is needed for any test that
// re-renders ItemsList — the content of the calls isn't what these tests are
// checking; see FlipList.test.tsx for that. Installed once,
// module-wide, rather than per-test with cleanup: `afterEach` hooks run in
// reverse registration order, so a stub torn down in this file's own
// `afterEach` would already be gone by the time RTL's global `afterEach(cleanup)`
// (registered earlier, in test-utils/setup.ts) unmounts the tree and flushes
// any animation the unmount itself triggers.
// eslint-disable-next-line @typescript-eslint/unbound-method, @typescript-eslint/no-unnecessary-condition -- polyfill assignment; DOM lib types claim this is always defined, but jsdom doesn't implement it, so the guard is load-bearing at runtime
Element.prototype.animate ??= (() => ({ finished: new Promise(() => {/* never settles */}), cancel: vi.fn() })) as unknown as typeof Element.prototype.animate

type Row = Parameters<typeof rowSortKey>[0]

function linkRow(idx: number, occ: Occurrence | undefined, ref = 'note.md'): Row {
  return { entry: { ...parseItemEntry(`[[${ref}]]`), idx }, occ }
}

function taskRow(idx: number, raw: string): Row {
  return { entry: { ...parseItemEntry(raw), idx }, occ: undefined }
}

const FUTURE = new Date('2099-01-01T09:00:00')
const PAST   = new Date('2000-01-01T09:00:00')

describe('rowSortKey', () => {
  it('groups an undone link to a note as [0, 0, title]', () => {
    const occ = makeOcc({ date: '', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'My Note', tags: [], items: [] } })
    expect(rowSortKey(linkRow(0, occ))).toEqual([0, 0, 'my note'])
  })

  it('groups an undone link to a future event as [1, jsTime, ""]', () => {
    const occ = makeOcc({
      date: '2099-01-01', time: '09:00',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Launch', tags: [], items: [], jsTime: FUTURE },
    })
    expect(rowSortKey(linkRow(0, occ))).toEqual([1, FUTURE.getTime(), ''])
  })

  it.each([
    ['high', 0], ['medium', 1], ['low', 2], [undefined, 3],
  ] as const)('groups an undone link to a %s-priority task as [2, %i, title]', (priority, rank) => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Task', tags: [], items: [], done: false, priority } })
    expect(rowSortKey(linkRow(0, occ))).toEqual([2, rank, 'task'])
  })

  it('groups an open string task as [3, idx, ""] — sorted by stored order, not text', () => {
    expect(rowSortKey(taskRow(7, '[ ] buy milk'))).toEqual([3, 7, ''])
  })

  it('groups a done task-link as [4, 2 (doneKindOrder task), title]', () => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Finished', tags: [], items: [], done: true } })
    expect(rowSortKey(linkRow(0, occ))).toEqual([4, 2, 'finished'])
  })

  it('groups a past event-link as [4, 1 (doneKindOrder event), title]', () => {
    const occ = makeOcc({
      date: '2000-01-01', time: '09:00',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Old Meeting', tags: [], items: [], jsTime: PAST },
    })
    expect(rowSortKey(linkRow(0, occ))).toEqual([4, 1, 'old meeting'])
  })

  it('groups a done string task as [4, 2 (doneKindOrder task), text]', () => {
    expect(rowSortKey(taskRow(0, '[x] buy milk'))).toEqual([4, 2, 'buy milk'])
  })

  it('groups a link with no resolvable occurrence as [5, idx, ""] — broken link', () => {
    expect(rowSortKey(linkRow(3, undefined))).toEqual([5, 3, ''])
  })
})

describe('ItemsList sort order (end-to-end via rowSortKey)', () => {
  // Mirrors the production comparator in ItemsList's `sortedRows`, built on
  // top of the exported `rowSortKey` so this exercises the real per-row logic.
  function sortRows(rows: Row[]): Row[] {
    return [...rows].sort((a, b) => {
      const [ga, na, sa] = rowSortKey(a)
      const [gb, nb, sb] = rowSortKey(b)
      if (ga !== gb) return ga - gb
      if (na !== nb) return na - nb
      return sa.localeCompare(sb)
    })
  }

  it('orders notes -> events chronologically -> open tasks by priority -> open string tasks -> done items -> broken links', () => {
    const note        = makeOcc({ date: '', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Note', tags: [], items: [] } })
    const laterEvent   = makeOcc({ date: '2099-01-02', time: '09:00', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Later', tags: [], items: [], jsTime: new Date('2099-01-02T09:00:00') } })
    const soonerEvent  = makeOcc({ date: '2099-01-01', time: '09:00', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Sooner', tags: [], items: [], jsTime: FUTURE } })
    const highTask     = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'High prio', tags: [], items: [], done: false, priority: 'high' } })
    const lowTask      = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Low prio', tags: [], items: [], done: false, priority: 'low' } })
    const doneTaskLink = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Done link', tags: [], items: [], done: true } })

    const rows: Row[] = [
      linkRow(10, doneTaskLink),
      linkRow(9, undefined),                      // broken link
      taskRow(1, '[ ] second stored task'),
      linkRow(8, lowTask),
      taskRow(0, '[ ] first stored task'),
      linkRow(7, highTask),
      taskRow(2, '[x] done string task'),
      linkRow(6, laterEvent),
      linkRow(5, soonerEvent),
      linkRow(4, note),
    ]

    const titles = sortRows(rows).map(({ entry, occ }) =>
      entry.kind === 'link' ? occ?.metadata.title : entry.text,
    )

    expect(titles).toEqual([
      'Note',
      'Sooner', 'Later',
      'High prio', 'Low prio',
      'first stored task', 'second stored task',
      'Done link', 'done string task',
      undefined, // broken link has no title
    ])
  })
})

function Harness({ initialItems, roots }: { initialItems: string[]; roots: Roots }) {
  const [items, setItems] = useState(initialItems)
  return (
    <ItemsList
      items={items}
      onChange={setItems}
      roots={roots}
      currentKey={null}
      vaultId={TEST_VAULT}
      onPromote={() => null}
    />
  )
}

describe('ItemsList active/done split', () => {
  it('shows open tasks immediately and hides done tasks behind a collapsed "Done" section', () => {
    render(<Harness initialItems={['[ ] Buy milk', '[x] Return books']} roots={makeRoots('current.md')} />)

    expect(screen.getByText('Buy milk')).toBeInTheDocument()
    expect(screen.queryByText('Return books')).not.toBeInTheDocument()
    expect(screen.getByText('Done · 1')).toBeInTheDocument()
  })

  it('reveals done tasks when the Done section is expanded', () => {
    render(<Harness initialItems={['[ ] Buy milk', '[x] Return books']} roots={makeRoots('current.md')} />)

    fireEvent.click(screen.getByText('Done · 1'))

    expect(screen.getByText('Return books')).toBeInTheDocument()
  })
})

/**
 * A row on its way out stays mounted and squeezes shut in flow — so what marks
 * it is a grid row driven to `0fr`, not a separate overlay element.
 */
function collapsingRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[inert]')]
    .filter(el => el.style.gridTemplateRows === '0fr')
}

describe('ItemsList exit animation', () => {
  it('renders an exiting overlay when a task is marked done', () => {
    render(<Harness initialItems={['[ ] Buy milk']} roots={makeRoots('current.md')} />)

    fireEvent.click(screen.getByRole('checkbox'))

    // The task moved to the (collapsed, invisible) done group, so the only
    // surviving on-screen copy is the row being held back mid-collapse.
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
    expect(collapsingRows()).toHaveLength(1)
  })

  it('does not begin an exit animation when un-checking an already-done task', () => {
    render(<Harness initialItems={['[x] Return books']} roots={makeRoots('current.md')} />)

    fireEvent.click(screen.getByText('Done · 1'))
    fireEvent.click(screen.getByRole('checkbox'))

    expect(collapsingRows()).toHaveLength(0)
  })
})

describe('ItemsList wikilink rows', () => {
  // onToggleDone wraps the real production action (rather than a bare
  // vi.fn()) so these exercise the actual store mutation the exit-animation
  // decision reads back — a mock that never touches the store can't tell
  // this fixed logic apart from the bug it fixes (see the recurring-series
  // case below).
  it('calls onToggleDone and begins an exit animation when a standalone linked task is checked off', () => {
    const occ = makeOcc({ entryKey: testKey('linked.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'linked.md', participants: [], title: 'Linked Task', tags: [], items: [], done: false } })
    const onToggleDone = vi.fn(toggleOccDone)
    const roots = makeRoots('current.md')
    roots.set(testKey('linked.md'), makeRootMeta('linked.md', { title: 'Linked Task', tags: [], items: [] }))
    seedStore([occ], roots)

    function LinkHarness() {
      const [items, setItems] = useState(['[[linked.md]]'])
      return (
        <ItemsList
          items={items}
          onChange={setItems}
          roots={roots}
          currentKey={testKey('current.md')}
          vaultId={TEST_VAULT}
          onPromote={() => null}
          onToggleDone={onToggleDone}
        />
      )
    }

    render(<LinkHarness />)

    fireEvent.click(screen.getByRole('checkbox'))

    // The occurrence onToggleDone receives is the one resolved from the store's
    // `fom` map (joined + expanded), not the raw seeded object — it carries
    // extra computed fields (jsTime, excluded), so match on identity, not equality.
    expect(onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ entryKey: testKey('linked.md') }))
    // Checking off the file's only occurrence leaves nothing else to
    // represent it, so it truly leaves the active list — exit animation.
    expect(collapsingRows()).toHaveLength(1)
  })

  it('does not begin an exit animation when checking off one occurrence of a recurring linked series', () => {
    // A wikilink row represents a *file*, not a single occurrence: for a daily
    // series with no end, checking off today's occurrence just makes
    // fileOccurrenceMap's resolveOneKey re-resolve to tomorrow's — still open —
    // occurrence. The row never leaves the active list, so there's nothing to
    // fade: an exit animation here would show a stale ghost over a row that's
    // still there, just displaying a different date.
    const series = makeSeries({
      entryKey: testKey('linked.md'),
      date: '2026-01-01',
      time: null,
      repeat: { type: 'schedule', freq: 'daily' },
      metadata: { participants: [], done: false },
    })
    const onToggleDone = vi.fn(toggleOccDone)
    const roots = makeRoots('current.md')
    roots.set(testKey('linked.md'), makeRootMeta('linked.md', { title: 'Linked Task', tags: [], items: [] }))
    seedStore([series], roots)

    function LinkHarness() {
      const [items, setItems] = useState(['[[linked.md]]'])
      return (
        <ItemsList
          items={items}
          onChange={setItems}
          roots={roots}
          currentKey={testKey('current.md')}
          vaultId={TEST_VAULT}
          onPromote={() => null}
          onToggleDone={onToggleDone}
        />
      )
    }

    render(<LinkHarness />)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ entryKey: testKey('linked.md') }))
    expect(collapsingRows()).toHaveLength(0)
  })
})

describe('ItemsList link picker', () => {
  it('excludes files already linked in items from the "Link file" list', () => {
    const roots = makeRoots('current.md')
    roots.set(testKey('other.md'), makeRootMeta('other.md', { title: 'Other File' }))
    roots.set(testKey('third.md'), makeRootMeta('third.md', { title: 'Third File' }))

    render(<Harness initialItems={['[[other.md]]']} roots={roots} />)

    fireEvent.click(screen.getByText('Add item…'))

    expect(screen.queryByText('Other File')).not.toBeInTheDocument()
    expect(screen.getByText('Third File')).toBeInTheDocument()
  })

  it('reopens a done file when it is picked from the "Link file" list', () => {
    const doneOcc = makeOcc({
      id: 'occ-1', entryKey: testKey('done.md'), date: '2020-01-01',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'done.md', participants: [], title: 'Old Task', tags: [], items: [], done: true },
    })
    const roots = makeRoots('current.md')
    roots.set(testKey('done.md'), makeRootMeta('done.md', { title: 'Old Task' }))
    seedStore([doneOcc], roots)

    render(<Harness initialItems={[]} roots={roots} />)

    fireEvent.click(screen.getByText('Add item…'))
    fireEvent.click(screen.getByText('Old Task'))

    // Same reopen procedure `redoItem` runs for a done row already in the
    // list (see the "Done items" group) — a fresh undated, undone occurrence
    // for the file, alongside the original done one.
    const doneKeyItems = useStore.getState().items.filter(i => i.entryKey === testKey('done.md')) as StoreOcc[]
    expect(doneKeyItems).toHaveLength(2)
    const reopened = doneKeyItems.find(i => i.id !== 'occ-1')
    expect(reopened?.metadata.done).toBe(false)
    expect(persistence.writes).toContain(testKey('done.md'))
  })
})
