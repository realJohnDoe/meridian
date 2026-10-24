// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import type * as ReactRouter from '@tanstack/react-router'
import { titleToSlug, entryKey as makeEntryKey } from '@/fileIO'
import { isSeries } from '@/types'
import type { FileMetadata, Roots, StoreItem } from '@/types'
import type { EntryKey } from '@/fileIO'
import type { VaultRef } from '@/vaultRef'
import { entriesOf } from '@/test-utils'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeSeries, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { useEntryEditor } from './useEntryEditor'

const { navigateMock, backMock } = vi.hoisted(() => ({ navigateMock: vi.fn(), backMock: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const [actual, { navigateStub }] = await Promise.all([importOriginal<typeof ReactRouter>(), import('@/test-utils/router')])
  return { ...actual, ...navigateStub({ navigate: navigateMock, back: backMock }) }
})

setupStore()
const persistence = installFakePersistence()

beforeEach(() => {
  navigateMock.mockClear()
  backMock.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useEntryEditor', () => {
  it('meta save (handleDoneToggle) writes synchronously', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleDoneToggle() })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(result.current.entry.done).toBe(true)
  })

  it('switching scope to "add" resets done, even though it was done just before the switch', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: true } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    expect(result.current.entry.done).toBe(true)

    act(() => { result.current.handleScopeChange('add') })

    expect(result.current.entry.done).toBe(false)
  })

  it('selecting an edit scope does not itself write', () => {
    // Choosing a scope says which occurrences the *next* edit covers — it is
    // not an edit. Committing here wrote the entry at the new scope with every
    // field unchanged, which for 'future' means `applyFuture` splitting the
    // series on the spot: merely opening "edit this and all following
    // occurrences" cut a daily series in two and started a new one still
    // carrying the old daily rule.
    const series = makeSeries({
      id: 'series-1', entryKey: testKey('note.md'), date: '2026-05-26', time: null,
      repeat: { type: 'schedule', freq: 'daily' },
    })
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1', date: '2026-09-10', time: null, source: 'generated', metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([series, occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleScopeChange('future') })

    expect(persistence.writes).toEqual([])
    expect(result.current.entry.editScope).toBe('future')
  })

  it('a future-scope repeat change splits the series once, with the picked rule', () => {
    // The reported flow, in the order the UI allows it: the repeat chip is
    // hidden while the scope is 'single' on a series occurrence, so the scope
    // is chosen first and the rule picked after. That must produce exactly one
    // split — the original capped the day before, and one new series carrying
    // the picked rule. Committing on the scope change produced two: a daily one
    // (an occurrence on every later day) beside the after_completion one (two
    // occurrences on the split day).
    const series = makeSeries({
      id: 'series-1', entryKey: testKey('note.md'), date: '2026-05-26', time: null,
      repeat: { type: 'schedule', freq: 'daily' },
    })
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1', date: '2026-09-10', time: null, source: 'generated', metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([series, occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleScopeChange('future') })
    act(() => { result.current.dialogHandlers.onRepeatConfirm({ type: 'after_completion', interval: '2 days' }) })

    const written = persistence.contentByKey.get(testKey('note.md')) ?? ''
    expect(written).toContain('type: after_completion')
    expect(written).toContain('interval: 2 days')
    // The original leg keeps the daily rule, capped the day before the split.
    expect(written).toContain('date: 2026-09-09')
    // Exactly one series starts on the split date, and no daily rule outlives
    // the cap — the two halves of the bug report.
    expect(written.match(/^ {2}- date: 2026-09-10$/gm)).toHaveLength(1)
    expect(written.match(/freq: daily/g)).toHaveLength(1)
  })

  it('switching scope still re-derives a repeat the user has not touched', () => {
    const series = makeSeries({
      id: 'series-1', entryKey: testKey('note.md'), date: '2026-05-26', time: null,
      repeat: { type: 'schedule', freq: 'daily' },
    })
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1', date: '2026-09-10', time: null, source: 'generated', metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([series, occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    expect(result.current.entry.repeat).toBeNull() // scope 'single' carries no repeat

    act(() => { result.current.handleScopeChange('future') })

    expect(result.current.entry.repeat).toEqual({ type: 'schedule', freq: 'daily' })
  })

  // The next two were found by `singleWriter.test.tsx`'s generated sequences,
  // and pinned here as the flows a person would actually perform. Both are the
  // same staleness: `useEntryEditor` pins `entry.item` for the session, a
  // 'future' save re-homes that occurrence onto the series it splits off, and
  // every later save arrived still naming the series it had left.
  const dailySeriesAndOverride = () => {
    const series = makeSeries({
      id: 'series-1', entryKey: testKey('note.md'), date: '2026-05-26', time: null,
      repeat: { type: 'schedule', freq: 'daily' },
    })
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1', date: '2026-09-10', time: null, metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([series, occ], makeRoots('note.md'))
    return occ
  }

  describe('removing a repeat', () => {
    // An override is a change *to an occurrence of a series*, so it cannot
    // outlive the rule — `applyAll` drops the children with it. The user is
    // asked first, but only where that costs them something.
    const seriesWith = (children: StoreItem[]) => {
      const series = makeSeries({
        id: 'series-1', entryKey: testKey('note.md'), date: '2026-05-26', time: null,
        repeat: { type: 'schedule', freq: 'daily' },
      })
      seedStore([series, ...children], makeRoots('note.md', { title: 'Standup' }))
      return makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1', date: '2026-05-26', time: null, source: 'generated', metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Standup', done: false } })
    }
    const override = (id: string, date: string) => makeOcc({
      id, entryKey: testKey('note.md'), ownerId: 'series-1', date, time: null,
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: true },
    })

    it('an untouched series just stops repeating, with nothing to confirm', () => {
      const occ = seriesWith([])
      const { result } = renderHook(() => useEntryEditor(occ))

      act(() => { result.current.handleScopeChange('all') })
      act(() => { result.current.dialogHandlers.onRepeatRemove() })

      expect(result.current.dialogHandlers.pendingRepeatRemove).toBeNull()
      const items = useStore.getState().items
      expect(items).toHaveLength(1)
      expect(isSeries(items[0]!)).toBe(false)
      // On the series' anchor — which is the date the form was showing, since
      // that is what `applyScope` puts there at 'all' scope. The surviving
      // occurrence is the one the user could see while they removed the rule.
      expect(items[0]?.date).toBe('2026-05-26')
      expect(persistence.contentByKey.get(testKey('note.md')) ?? '').not.toContain('repeat')
    })

    it('asks first when changed occurrences would go with the rule', () => {
      const occ = seriesWith([override('o-1', '2026-06-02'), override('o-2', '2026-06-09')])
      const { result } = renderHook(() => useEntryEditor(occ))

      act(() => { result.current.handleScopeChange('all') })
      act(() => { result.current.dialogHandlers.onRepeatRemove() })

      // Nothing written until the question is answered.
      expect(result.current.dialogHandlers.pendingRepeatRemove?.lost).toBe(2)
      expect(persistence.writes).toEqual([])
      expect(useStore.getState().items).toHaveLength(3)

      act(() => { result.current.dialogHandlers.pendingRepeatRemove?.onConfirm() })

      const items = useStore.getState().items
      expect(items).toHaveLength(1)
      expect(isSeries(items[0]!)).toBe(false)
    })

    it('cancelling leaves the series exactly as it was', () => {
      const occ = seriesWith([override('o-1', '2026-06-02')])
      const { result } = renderHook(() => useEntryEditor(occ))

      act(() => { result.current.handleScopeChange('all') })
      act(() => { result.current.dialogHandlers.onRepeatRemove() })
      act(() => { result.current.dialogHandlers.onRepeatRemoveClose() })

      expect(persistence.writes).toEqual([])
      expect(useStore.getState().items).toHaveLength(2)
      expect(result.current.entry.repeat).toEqual({ type: 'schedule', freq: 'daily' })
    })

    it('an exclusion stub is not something to confirm losing', () => {
      // A stub records "don't generate this slot", which means nothing once
      // nothing is generated — dropping it costs the user nothing they could
      // point at, so it must not put a dialog in the way.
      const stub = { ...override('o-1', '2026-06-02'), excluded: true }
      const occ = seriesWith([stub])
      const { result } = renderHook(() => useEntryEditor(occ))

      act(() => { result.current.handleScopeChange('all') })
      act(() => { result.current.dialogHandlers.onRepeatRemove() })

      expect(result.current.dialogHandlers.pendingRepeatRemove).toBeNull()
      expect(useStore.getState().items).toHaveLength(1)
    })

    it('at "future" scope the earlier occurrences keep repeating', () => {
      const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1', date: '2026-06-10', time: null, source: 'generated', metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Standup', done: false } })
      const series = makeSeries({
        id: 'series-1', entryKey: testKey('note.md'), date: '2026-05-26', time: null,
        repeat: { type: 'schedule', freq: 'daily' },
      })
      seedStore([series, override('o-1', '2026-06-02'), override('o-2', '2026-06-17')], makeRoots('note.md', { title: 'Standup' }))
      const { result } = renderHook(() => useEntryEditor(occ))

      act(() => { result.current.handleScopeChange('future') })
      act(() => { result.current.dialogHandlers.onRepeatRemove() })

      // Only the override at/after the cut is at stake; the earlier one is not.
      expect(result.current.dialogHandlers.pendingRepeatRemove?.lost).toBe(1)
      act(() => { result.current.dialogHandlers.pendingRepeatRemove?.onConfirm() })

      const items = useStore.getState().items
      const stillSeries = items.filter(isSeries)
      expect(stillSeries).toHaveLength(1)
      expect(stillSeries[0]?.repeat).toMatchObject({ end: { type: 'until', date: '2026-06-09' } })
      // The cut occurrence survives as a standalone; the one after it does not.
      const standalone = items.filter(i => !isSeries(i) && !i.ownerId)
      expect(standalone.map(i => i.date)).toEqual(['2026-06-10'])
      expect(items.some(i => i.date === '2026-06-17')).toBe(false)
      // …and the one before the cut is untouched.
      expect(items.some(i => i.date === '2026-06-02')).toBe(true)
    })
  })

  it('a brand-new entry keeps what was typed once its first save creates the file', () => {
    // The form derives every untouched field from the store, and a brand-new
    // entry has no store row until its first save makes one. If the edit set
    // were emptied before the view switched onto that row, the form would fall
    // back to the seed and blank the title the save had just written.
    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Buy milk'))

    act(() => { result.current.scheduleAutoSave('some notes') })
    act(() => { vi.advanceTimersByTime(1500) })

    expect(result.current.entry.title).toBe('Buy milk')
    expect(result.current.entry.body).toBe('some notes')
    expect(result.current.createdKey).not.toBeNull()

    // And a later edit still lands on the same file rather than a second one.
    act(() => { result.current.dialogHandlers.onPriority('high') })
    const key = result.current.createdKey!
    expect(persistence.contentByKey.get(key) ?? '').toContain('priority: high')
    expect(persistence.contentByKey.get(key) ?? '').toContain('Buy milk')
    expect(new Set(persistence.writes).size).toBe(1)
  })

  it('a second "future" save edits the series the first one split off', () => {
    // Splitting again off the stale owner capped an already-capped series and
    // stood a second new one beside it, so the split day grew an occurrence
    // per edit.
    const occ = dailySeriesAndOverride()
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleScopeChange('future') })
    act(() => { result.current.dialogHandlers.onRepeatConfirm({ type: 'schedule', freq: 'weekly' }) })
    act(() => { result.current.dialogHandlers.onDurConfirm('1 hour') })

    const onSplitDay = useStore.getState().items.filter(i => isSeries(i) && i.date === '2026-09-10')
    expect(onSplitDay).toHaveLength(1)
    expect(onSplitDay[0]?.metadata.duration).toBe('1 hour')
  })

  it('a "single" save after a split updates the override instead of adding one', () => {
    // `upsertOverride` matches ownerId *and* id, so a stale ownerId missed the
    // override that was already there and appended a duplicate on its date.
    const occ = dailySeriesAndOverride()
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleScopeChange('future') })
    act(() => { result.current.dialogHandlers.onDurConfirm('1 hour') })
    act(() => { result.current.handleScopeChange('single') })
    act(() => { result.current.dialogHandlers.onPriority('low') })

    const onDay = useStore.getState().items.filter(i => !isSeries(i) && i.date === '2026-09-10')
    expect(onDay).toHaveLength(1)
    expect(onDay[0]?.metadata.priority).toBe('low')
  })

  it('a there-and-back through "add" scope does not un-tick a completed task', () => {
    // Same shape as the repeat conflict below, cashed out as data loss instead
    // of a toast: 'add' blanks `done` in the form, and switching back read the
    // blank back as the current state. The next ordinary edit — a priority, a
    // typed character — then carried `done: false` to disk for a task nobody
    // had unticked.
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Task', done: true } })
    seedStore([occ], makeRoots('note.md', { title: 'Task' }))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleScopeChange('add') })
    expect(result.current.entry.done).toBe(false) // the 'add' view's own blank
    act(() => { result.current.handleScopeChange('single') })
    expect(result.current.entry.done).toBe(true)

    act(() => { result.current.dialogHandlers.onPriority('high') })

    expect(useStore.getState().items.find(i => i.id === 'occ-1')?.metadata.done).toBe(true)
    expect(persistence.contentByKey.get(testKey('note.md')) ?? '').toContain('done: true')
  })

  it('changing the repeat after a scope switch does not report a conflict with nobody', () => {
    // The reported flow: an after_completion task, its interval changed from 2
    // days to 3, on a vault only this device writes to — and a toast saying
    // "the repeat also changed somewhere else". The repeat is only editable at
    // 'all' scope, so the scope switch always precedes the change; it left
    // `baseRef` describing 'single' scope, where `applyScope` drops the repeat
    // entirely. The save then saw base `null`, editor '3 days' and store
    // '2 days' — three different values for one field, which is what
    // `overlappingFields` calls a conflict.
    const series = makeSeries({
      id: 'series-1', entryKey: testKey('note.md'), date: '2026-05-26', time: null,
      repeat: { type: 'after_completion', interval: '2 days' },
    })
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1', date: '2026-09-10', time: null, metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([series, occ], makeRoots('note.md'))
    const warning = vi.spyOn(toast, 'warning').mockImplementation(() => '')
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleScopeChange('all') })
    act(() => { result.current.dialogHandlers.onRepeatConfirm({ type: 'after_completion', interval: '3 days' }) })

    expect(warning).not.toHaveBeenCalled()
    expect(persistence.contentByKey.get(testKey('note.md')) ?? '').toContain('interval: 3 days')
    warning.mockRestore()
  })

  it('autosave debounces body writes by 1500ms and commits the latest scheduled body', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('draft 1') })
    act(() => { vi.advanceTimersByTime(700) })
    act(() => { result.current.scheduleAutoSave('draft 2') }) // resets the debounce timer
    act(() => { vi.advanceTimersByTime(1499) })
    expect(persistence.writes).toEqual([])

    act(() => { vi.advanceTimersByTime(1) })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('draft 2')
  })

  it('a scheduled autosave commits against the latest entry state, not a stale snapshot', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('draft') })
    act(() => { result.current.handleDoneToggle() }) // synchronous meta save, before the autosave timer fires
    act(() => { vi.advanceTimersByTime(1500) })

    expect(persistence.writes).toEqual([testKey('note.md'), testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('draft')
    const saved = useStore.getState().items.find(i => i.id === 'occ-1') as { metadata: { done?: boolean } } | undefined
    expect(saved?.metadata.done).toBe(true)
  })

  it('goBack flushes a still-pending autosave immediately instead of dropping it', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('unsaved draft') })
    // Navigate away (e.g. tapping back) before the 1500ms debounce elapses.
    act(() => { result.current.handleClose() })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('unsaved draft')
  })

  it('commits a brand-new item on close even when the creating edit never got a chance to debounce', () => {
    // Reproduces the reported bug: typing a title arms the debounced autosave
    // (see EntryEditor's title onChange), but navigating back immediately —
    // well within the 1500ms window — used to just clearTimeout the pending
    // commit, silently dropping the brand-new item.
    const { result } = renderHook(() => useEntryEditor(null))
    const key = testKey(titleToSlug('Brand new task'))

    act(() => { result.current.setEntry({ ...result.current.entry, title: 'Brand new task' }) })
    act(() => { result.current.scheduleAutoSave('') })
    act(() => { result.current.handleClose() })

    expect(persistence.writes).toEqual([key])
    expect(useStore.getState().items.filter(i => i.entryKey === key)).toHaveLength(1)
  })

  it('flushes a still-pending autosave on unmount (e.g. navigating to a wikilink)', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md'))
    const { result, unmount } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('draft body') })
    act(() => { unmount() })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('draft body')
  })

  it('a new entry with a title commits on mount without navigating away', () => {
    const { result } = renderHook(() => useEntryEditor(null, 'single', 'My New Task'))
    const key = testKey(titleToSlug('My New Task'))

    expect(persistence.writes).toEqual([key])
    // Asserting the *content*, not just that a save was requested for the key.
    // The key-only assertion this used to make passed for the whole time the
    // write path was silently dropping the file — "a save was requested for K"
    // and "K was written" are different claims, and only one of them was ever
    // checked anywhere in the suite.
    expect(persistence.contentByKey.get(key)).toContain('title: My New Task')
    // Navigating away mid-session used to tear down the editor (and any open
    // dialog) the instant the first save landed — see the duplicate-entry
    // investigation. The created item is now adopted internally instead, so
    // the editor stays mounted on /entry/new for the rest of the session.
    expect(navigateMock).not.toHaveBeenCalled()
    expect(result.current.entry.item).toBeNull()
  })

  it('a metadata save fired right after the creating save upserts instead of duplicating the item', () => {
    // Reproduces the reported bug: typing a title arms the debounced body
    // autosave, but confirming a dialog (date/time/duration/priority) before
    // that timer fires calls saveMeta synchronously — landing a second
    // create-scoped commit while the hook still thinks no item exists yet.
    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Board game night'))
    const key = testKey(titleToSlug('Board game night'))

    expect(useStore.getState().items.filter(i => i.entryKey === key)).toHaveLength(1)

    act(() => { result.current.handleDoneToggle() })

    expect(useStore.getState().items.filter(i => i.entryKey === key)).toHaveLength(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('resumes the file its own draft already created instead of opening a second one', () => {
    // Reproduces the reported bug: the task is created from /entry/new, gets a
    // priority, and the user leaves to make the list it should go on. Coming
    // *back* to that same /entry/new history entry remounts the editor — with a
    // fresh draft id it no longer recognised the file its first visit made, so
    // it created `buy-milk-2` beside it, carrying the title but none of the
    // edits. The route now derives the draft id from the history entry (see
    // `__TSR_key` in _entry.entry.new.tsx), which is what this passes.
    const draftId = 'history-entry-1'
    const key = testKey(titleToSlug('Buy milk'))

    const first = renderHook(() => useEntryEditor(null, 'all', 'Buy milk', undefined, draftId))
    act(() => { first.result.current.saveMeta({ ...first.result.current.entry, priority: 'high' }) })
    act(() => { first.unmount() })

    renderHook(() => useEntryEditor(null, 'all', 'Buy milk', undefined, draftId))

    expect([...useStore.getState().roots.keys()]).toEqual([key])
    expect(useStore.getState().items.filter(i => i.entryKey === key)).toHaveLength(1)
    // What the resumed session then *shows* is the route's job, not the hook's:
    // it redirects to the file this lookup found rather than mounting a blank
    // editor over it — see NewEntryDraft in _entry.entry.new.tsx.
  })

  it('still creates a second file for a genuinely new draft with the same title', () => {
    // The other half of the draft-id rule: a *different* history entry means a
    // different entry, so it gets a free slug rather than upserting onto the
    // file some earlier draft is sitting on.
    renderHook(() => useEntryEditor(null, 'all', 'Buy milk', undefined, 'history-entry-1'))
    renderHook(() => useEntryEditor(null, 'all', 'Buy milk', undefined, 'history-entry-2'))

    expect([...useStore.getState().roots.keys()].sort())
      .toEqual([testKey('buy-milk'), testKey('buy-milk-2')])
  })

  describe('the "listed on" picker on a brand-new draft', () => {
    const listKey = testKey('groceries')

    function seedList() {
      const list = makeOcc({ id: 'list-1', entryKey: listKey, date: '', metadata: { vaultId: TEST_VAULT, fileSlug: 'groceries', title: 'Groceries' } })
      seedStore([list], makeRoots('groceries', { title: 'Groceries' }))
    }

    it('writes the link on the pick, without waiting for another edit to save', () => {
      // Reproduces the reported bug: the pick only landed in `pendingKeys`,
      // to be flushed by whatever commit came next — and both Save and Back
      // flush nothing when no autosave is pending, so a pick made last was
      // dropped without a trace.
      seedList()
      const { result } = renderHook(() => useEntryEditor(null, 'all', 'Buy milk'))

      act(() => { result.current.pendingLinks.handleAdd(listKey) })

      expect(useStore.getState().roots.get(listKey)?.items).toEqual(['[[buy-milk]]'])
    })

    it('survives Save', () => {
      seedList()
      const { result } = renderHook(() => useEntryEditor(null, 'all', 'Buy milk'))

      act(() => { result.current.pendingLinks.handleAdd(listKey) })
      act(() => { result.current.handleSave('') })

      expect(useStore.getState().roots.get(listKey)?.items).toEqual(['[[buy-milk]]'])
    })

    it('unwrites a link the pick already committed when it is removed again', () => {
      seedList()
      const { result } = renderHook(() => useEntryEditor(null, 'all', 'Buy milk'))

      act(() => { result.current.pendingLinks.handleAdd(listKey) })
      act(() => { result.current.pendingLinks.handleRemove(listKey) })

      expect(useStore.getState().roots.get(listKey)?.items).toEqual([])
    })

    it('creates the list the picker was asked for and puts this entry on it', () => {
      const { result } = renderHook(() => useEntryEditor(null, 'all', 'Buy milk'))

      act(() => { result.current.handleCreateList('Shopping') })

      const roots = useStore.getState().roots
      expect(roots.get(testKey('shopping'))?.title).toBe('Shopping')
      expect(roots.get(testKey('shopping'))?.items).toEqual(['[[buy-milk]]'])
      // A list is a note: nothing to schedule, nothing to tick.
      const list = useStore.getState().items.find(i => i.entryKey === testKey('shopping'))
      expect(list?.date).toBe('')
      expect((list?.metadata as { done?: boolean }).done).toBeUndefined()
    })

    it('links an existing entry to a list it creates, same as it links an existing one', () => {
      const occ = makeOcc({ id: 'occ-1', entryKey: testKey('buy-milk'), metadata: { vaultId: TEST_VAULT, fileSlug: 'buy-milk', title: 'Buy milk' } })
      seedStore([occ], makeRoots('buy-milk', { title: 'Buy milk' }))
      const { result } = renderHook(() => useEntryEditor(occ))

      act(() => { result.current.handleCreateList('Shopping') })

      expect(useStore.getState().roots.get(testKey('shopping'))?.items).toEqual(['[[buy-milk]]'])
    })
  })

  it('a new entry whose title slugifies onto an existing file leaves that file alone', () => {
    // Reproduces the reported bug: "Buy groceries!" slugifies to `buy-groceries`,
    // the slug an unrelated entry already owns. A write is a whole-file replace,
    // so creating the new entry there destroyed the existing one outright — no
    // error, no artifact, and every wikilink to it silently re-pointed.
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('buy-groceries'), date: '2026-04-08', metadata: { vaultId: TEST_VAULT, fileSlug: 'buy-groceries', title: 'Buy groceries', tags: ['errands'] } })
    seedStore([occ], makeRoots('buy-groceries', { title: 'Buy groceries', tags: ['errands'], body: 'Remember the bags.' }))

    renderHook(() => useEntryEditor(null, 'all', 'Buy groceries!'))

    const roots = useStore.getState().roots
    expect(roots.get(testKey('buy-groceries'))?.title).toBe('Buy groceries')
    expect(roots.get(testKey('buy-groceries'))?.body).toBe('Remember the bags.')
    expect(roots.get(testKey('buy-groceries-2'))?.title).toBe('Buy groceries!')
    expect(persistence.writes).toEqual([testKey('buy-groceries-2')])
  })

  it('later saves of a slug-collided new entry keep hitting its own file', () => {
    // The re-entrancy the applyNew guard exists for, on the collision path: the
    // creating save lands on `buy-groceries-2`, and the autosave that follows must
    // upsert onto it rather than allocate `buy-groceries-3` (or fall back onto the
    // unrelated `buy-groceries`).
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('buy-groceries'), date: '2026-04-08', metadata: { vaultId: TEST_VAULT, fileSlug: 'buy-groceries', title: 'Buy groceries' } })
    seedStore([occ], makeRoots('buy-groceries', { title: 'Buy groceries', body: 'Remember the bags.' }))

    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Buy groceries!'))
    act(() => { result.current.scheduleAutoSave('totally different note') })
    act(() => { vi.advanceTimersByTime(1500) })

    const roots = useStore.getState().roots
    expect([...roots.keys()].sort()).toEqual([testKey('buy-groceries'), testKey('buy-groceries-2')])
    expect(roots.get(testKey('buy-groceries'))?.body).toBe('Remember the bags.')
    expect(roots.get(testKey('buy-groceries-2'))?.body).toBe('totally different note')
    expect(useStore.getState().items.filter(i => i.entryKey === testKey('buy-groceries-2'))).toHaveLength(1)
  })

  it('handleSave on a not-yet-adopted new entry upserts instead of creating a second file', () => {
    // handleSave passes entry.item, which stays null for a brand-new entry even
    // after autosave created the file — so without the draft identity it asks for
    // another new entry and lands on a `-2` sibling of the file it just made.
    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Board game night'))
    expect(persistence.writes).toEqual([testKey('board-game-night')])

    act(() => { result.current.handleSave('body text') })

    expect([...useStore.getState().roots.keys()]).toEqual([testKey('board-game-night')])
    expect(useStore.getState().roots.get(testKey('board-game-night'))?.body).toBe('body text')
    expect(useStore.getState().items).toHaveLength(1)
  })

  it('a save after the entry lost its items keeps it whole instead of leaving a bare root', () => {
    // The reported bug, end to end: create from the search overlay, then change
    // the priority. The editor holds the occurrence its first save created, so
    // if the entry's items go while it stays open — a reconcile re-merging the
    // vault layer, another tab, a remote delete — the next save updated the
    // root and matched no item. That left a root with zero occurrences: search
    // reserved a row for it and drew nothing, and the write path refused to
    // persist it, so the entry died with the tab.
    const { result } = renderHook(() => useEntryEditor(null, 'all', 'handy', { date: '2026-08-18' }))
    const key = testKey(titleToSlug('handy'))
    expect(persistence.writes).toEqual([key])

    // The items disappear from under the open editor; the root survives.
    act(() => { useStore.getState().setData(entriesOf([], useStore.getState().roots)) })

    act(() => { result.current.dialogHandlers.onPriority('high') })

    const items = useStore.getState().items.filter(i => i.entryKey === key)
    expect(items).toHaveLength(1)
    expect(items[0]!.metadata.priority).toBe('high')
    expect(persistence.writes).toEqual([key, key])
    // The file the second save carried is a whole entry, not an empty document
    // — which is what the store would have serialized to with the root alone.
    const content = persistence.contentByKey.get(key)
    expect(content).toContain('title: handy')
    expect(content).toContain('priority: high')
  })

  it('editScope "add" suppresses both the meta save and the autosave', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ, 'add'))

    act(() => { result.current.handleDoneToggle() })
    act(() => { result.current.scheduleAutoSave('draft') })
    act(() => { vi.advanceTimersByTime(2000) })

    expect(persistence.writes).toEqual([])
    expect(result.current.entry.done).toBe(true) // local state still updates
  })

  it('a new entry with no title does not commit or navigate on mount', () => {
    renderHook(() => useEntryEditor(null))

    expect(persistence.writes).toEqual([])
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('handleSave with an empty title flags titleMissing and bumps focusTitleTick instead of navigating back', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.setEntry({ ...result.current.entry, title: '' }) })
    const tickBefore = result.current.focusTitleTick
    act(() => { result.current.handleSave('body') })

    expect(result.current.titleMissing).toBe(true)
    expect(result.current.focusTitleTick).toBe(tickBefore + 1)
    expect(backMock).not.toHaveBeenCalled()

    act(() => { result.current.setEntry({ ...result.current.entry, title: 'Standup again' }) })
    act(() => { result.current.handleSave('body') })
    expect(result.current.titleMissing).toBe(false)
    expect(backMock.mock.calls.length + navigateMock.mock.calls.length).toBeGreaterThan(0)
  })

  // #1120: with no vault registered at all (the Tutorial removed, nothing added
  // in its place — see EntryEditor.test.tsx's "no vault to save to" suite for the
  // banner this leans on), a brand-new entry has nowhere to land. Before the fix,
  // both the mount-time commit (a title seeded from search's "Create …") and
  // handleSave (Back) took saveNode's null the same way as an empty title,
  // flagging titleMissing on a title that was very much present.
  it('a brand-new entry with a title but no vault at all does not flag titleMissing, on mount or on handleSave', () => {
    useStore.setState({ defaultVaultId: null, vaults: [] })

    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Call the plumber'))
    expect(persistence.writes).toEqual([])
    expect(result.current.titleMissing).toBe(false)

    act(() => { result.current.handleSave('body') })

    expect(persistence.writes).toEqual([])
    expect(result.current.titleMissing).toBe(false)
    expect(backMock.mock.calls.length + navigateMock.mock.calls.length).toBeGreaterThan(0)
  })

  // #1120's product question: with only the read-only Tutorial vault registered
  // (defaultVaultId null, same setup as above but the Tutorial present), a
  // brand-new entry now falls back to the Tutorial's own sandbox vault instead of
  // having nowhere to go. `installFakePersistence` swaps out the whole
  // persistence port, so it can't see entityWrites.ts's own readOnly skip
  // (that's what actually keeps this from ever reaching Dexie or a push — see
  // ExampleBackend.write) — what this test can and does confirm is the part that
  // used to be broken: the save is no longer silently refused before it even
  // gets there, and the entry becomes visible in the store for the session.
  it('a brand-new entry falls back to the Tutorial sandbox vault when no writable vault is registered', () => {
    useStore.setState({ defaultVaultId: null, vaults: [{ id: 'example', name: 'Tutorial', kind: 'example' }] })

    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Call the plumber'))

    const key = makeEntryKey('example', titleToSlug('Call the plumber'))
    expect(result.current.vaultId).toBe('example')
    expect(result.current.titleMissing).toBe(false)
    expect(persistence.writes).toEqual([key])
    // Visible in the store for the session, the way agenda/search read it.
    expect(useStore.getState().roots.get(key)?.title).toBe('Call the plumber')
  })
})

describe('useEntryEditor — moving between vaults', () => {
  const OTHER = 'other-vault'
  const otherKey = (slug: string) => makeEntryKey(OTHER, slug)
  const VAULTS: VaultRef[] = [
    { id: TEST_VAULT, name: 'Work', kind: 'local' },
    { id: OTHER, name: 'Personal', kind: 'local' },
  ]

  function seedTwoVaults(rootMeta: Partial<FileMetadata> = {}) {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', rootMeta))
    useStore.setState({ vaults: VAULTS })
    return occ
  }

  it('picking a vault stages a move instead of applying one', () => {
    const occ = seedTwoVaults()
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toMatchObject({
      toVaultId: OTHER, fromVault: 'Work', toVault: 'Personal', slugTaken: false,
    })
    // Nothing has happened to the entry yet — the dialog decides.
    expect(persistence.moves).toEqual([])
    expect(useStore.getState().roots.has(testKey('note.md'))).toBe(true)
  })

  /**
   * Seed one more entry into the store — root *and* an occurrence, because an
   * entry is both. A root on its own is no longer a state the store can hold.
   */
  function seedEntry(key: EntryKey, root: FileMetadata): void {
    const items = [...useStore.getState().items, makeOcc({ id: `occ-${root.fileSlug}`, entryKey: key, date: '2026-01-01' })]
    const roots = new Map(useStore.getState().roots).set(key, root)
    act(() => { useStore.getState().setData(entriesOf(items, roots)) })
  }

  it('counts the links the move will break', () => {
    // This entry links to `other-note`, and `linker` links back to it. Both
    // links are inside the source vault, so both break.
    const occ = seedTwoVaults({ items: ['[[other-note]]'] })
    seedEntry(testKey('other-note'), { title: 'Other', tags: [], items: [], vaultId: TEST_VAULT, fileSlug: 'other-note' })
    seedEntry(testKey('linker'), { title: 'Linker', tags: [], items: ['[[note.md]]'], vaultId: TEST_VAULT, fileSlug: 'linker' })

    const { result } = renderHook(() => useEntryEditor(occ))
    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toMatchObject({ inbound: 1, outbound: 1 })
  })

  it('confirming moves the entry and navigates to its new URL', () => {
    const occ = seedTwoVaults()
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.onVaultChange?.(OTHER) })
    act(() => { result.current.onMoveConfirm() })

    expect(persistence.moves).toEqual([[testKey('note.md'), otherKey('note.md'), expect.stringContaining('title:')]])
    expect(result.current.pendingMove).toBeNull()
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({
      to: '/entry/$vault/$slug',
      params: { vault: OTHER, slug: 'note.md' },
      replace: true,
    }))
  })

  it('cancelling leaves the entry where it was', () => {
    const occ = seedTwoVaults()
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.onVaultChange?.(OTHER) })
    act(() => { result.current.onMoveCancel() })

    expect(result.current.pendingMove).toBeNull()
    expect(persistence.moves).toEqual([])
    expect(useStore.getState().roots.has(testKey('note.md'))).toBe(true)
  })

  it('flushes a pending body edit before counting, so a just-typed link is included', () => {
    const occ = seedTwoVaults()
    seedEntry(testKey('other-note'), { title: 'Other', tags: [], items: [], vaultId: TEST_VAULT, fileSlug: 'other-note' })

    const { result } = renderHook(() => useEntryEditor(occ))
    act(() => { result.current.scheduleAutoSave('see [[other-note]]') })
    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toMatchObject({ outbound: 1 })
  })

  it('warns when the target vault already owns the slug', () => {
    const occ = seedTwoVaults()
    seedEntry(otherKey('note.md'), { title: 'Theirs', tags: [], items: [], vaultId: OTHER, fileSlug: 'note.md' })

    const { result } = renderHook(() => useEntryEditor(occ))
    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toMatchObject({ slugTaken: true, toSlug: 'note.md-2' })
  })

  it('offers no move at all out of a non-writable vault', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: makeEntryKey('example', 'note.md'), metadata: { vaultId: 'example', fileSlug: 'note.md' } })
    const roots: Roots = new Map([[makeEntryKey('example', 'note.md'), { title: 'Note', tags: [], items: [], vaultId: 'example', fileSlug: 'note.md' }]])
    seedStore([occ], roots)
    useStore.setState({ vaults: [{ id: 'example', name: 'Tutorial', kind: 'example' }, ...VAULTS] })

    const { result } = renderHook(() => useEntryEditor(occ))

    expect(result.current.onVaultChange).toBeNull()
  })

  it('retargets rather than moves before the first save', () => {
    seedStore([], new Map())
    useStore.setState({ vaults: VAULTS })
    const { result } = renderHook(() => useEntryEditor(null))

    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toBeNull()
    expect(result.current.vaultId).toBe(OTHER)
    expect(persistence.moves).toEqual([])
  })
})
