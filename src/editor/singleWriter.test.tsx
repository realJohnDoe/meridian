// @vitest-environment jsdom
/**
 * A generator over **editor operation sequences**, and the two invariants that
 * must hold for every one of them when this device is the only writer.
 *
 * ## Why this exists
 *
 * `storage/` has had generated interleavings since #1021, because every sync
 * defect is a statement about an order of events across two devices. The
 * editor had no equivalent, and its defects turn out to have the same shape
 * one layer down: a statement about an order of events across one *session*.
 *
 * The editor used to keep two complete snapshots — `entry` (what is on screen)
 * and `baseRef` (what it last knew the store to agree with) — and infer "what
 * did the user change" by diffing them, which is only sound if every code path
 * that moves the form for a reason that is *not* a user edit also moves the
 * base. Nothing said so, and the bugs this file was written after were all a
 * broken pairing: a scope switch that moved the form and not the base (so the
 * next save saw three values for one field and reported a conflict with
 * nobody), an 'add'-scope view that blanked `done` and read the blank back as
 * the truth (so an unrelated later edit un-ticked a completed task), and a
 * pinned occurrence whose ownership the store had moved on from (so a second
 * 'future' save split an already-split series and a later 'single' save
 * appended a duplicate override).
 *
 * The editor now derives the form and records the edits (`edits.ts`), which is
 * what those failures argued for. These invariants stay because they are what
 * says so: every one of them was found here first, and the structure that
 * makes them hold is only worth having while something checks that it does.
 *
 * ## The two invariants
 *
 *  1. **No conflict is ever reported.** `reportDriftConflicts` fires when a
 *     field holds three different values across base, form and store. With one
 *     writer there is no second party for the third value to come from, so a
 *     warning here is by construction the editor disagreeing with itself.
 *  2. **A field no operation named keeps its value.** The whole point of
 *     `touchedFieldsOnly` is that a save writes what the user touched and
 *     leaves everything else alone. An untouched field that moves is a silent
 *     regression — the class this editor's three-way merge exists to prevent.
 *
 * ## The alphabet, and what it deliberately leaves out
 *
 * Every op below owns exactly one field, which is what makes invariant 2
 * checkable without re-implementing the editor to predict values. Two real ops
 * are left out because they own *several* fields on purpose and would need
 * their own model: `onDateRemove` (clears the duration with the date) and
 * `handleTypeChange` (clears the priority and the schedule on the way to a
 * note). Both are a gap here, not a claim that they are safe.
 *
 * Content is derived, not generated: the values an op writes are fixed
 * constants distinct from the fixture's, so a counterexample shrinks to a
 * minimal *sequence* rather than to an interesting string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import fc from 'fast-check'
import { toast } from 'sonner'
import type * as ReactRouter from '@tanstack/react-router'
import { resetCalendarOnVaultChange } from '@/calendar'
import { parseToStoreItems, expandRange } from '@/model'
import { setupStore, seedStore, installFakePersistence, testKey, TEST_VAULT } from '@/test-utils'
import type { EditScope } from '@/types'
import { useEntryEditor } from './useEntryEditor'

const { navigateMock, backMock } = vi.hoisted(() => ({ navigateMock: vi.fn(), backMock: vi.fn() }))
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const [actual, { navigateStub }] = await Promise.all([importOriginal<typeof ReactRouter>(), import('@/test-utils/router')])
  return { ...actual, ...navigateStub({ navigate: navigateMock, back: backMock }) }
})

/**
 * One entry carrying every watched field at a value nothing in the alphabet
 * writes, so "still there" is unambiguous. An `after_completion` series with a
 * stored override, because that is the shape where the editor holds a real
 * `live` item and the three-way merge is reachable at all — a generated
 * occurrence falls back to the editor's own fields and can never conflict.
 */
const FIXTURE = `---
title: Water the plants
tags:
  - garden
priority: high
duration: 30 minutes
date: 2026-05-23
defaults:
  done: false
repeat:
  type: after_completion
  interval: 2 days
instances:
  - date: 2026-07-23
    done: true
---
Body text.
`

/** Field → the marker its fixture value leaves in the persisted file. */
const WATCHED = {
  repeat:   'interval: 2 days',
  priority: 'priority: high',
  duration: 'duration: 30 minutes',
  done:     'done: true',
} as const
type Watched = keyof typeof WATCHED

/** One editor operation, and the single field it is entitled to change. */
interface Op {
  label:  string
  target: Watched | null
  run:    (h: ReturnType<typeof useEntryEditor>) => void
}

const SCOPES: EditScope[] = ['single', 'all', 'future', 'add']

const OPS: Op[] = [
  ...SCOPES.map((scope): Op => ({
    label: `scope:${scope}`,
    target: null, // choosing a scope says what the *next* edit covers; it is not an edit
    run: h => { h.handleScopeChange(scope) },
  })),
  { label: 'priority:low',    target: 'priority', run: h => { h.dialogHandlers.onPriority('low') } },
  { label: 'priority:none',   target: 'priority', run: h => { h.dialogHandlers.onPriority(null) } },
  { label: 'duration:1 hour', target: 'duration', run: h => { h.dialogHandlers.onDurConfirm('1 hour') } },
  { label: 'duration:remove', target: 'duration', run: h => { h.dialogHandlers.onDurRemove() } },
  { label: 'repeat:3 days',   target: 'repeat',   run: h => { h.dialogHandlers.onRepeatConfirm({ type: 'after_completion', interval: '3 days' }) } },
  { label: 'repeat:remove',   target: 'repeat',   run: h => { h.dialogHandlers.onRepeatRemove() } },
  { label: 'done:toggle',     target: 'done',     run: h => { h.handleDoneToggle() } },
]

setupStore()
const persistence = installFakePersistence()

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** Re-seed between property runs — `setupStore`'s hooks only fire per *test*. */
function freshEditor() {
  resetCalendarOnVaultChange()
  persistence.writes = []
  persistence.contentByKey = new Map()
  const parsed = parseToStoreItems('plants.md', FIXTURE, TEST_VAULT)
  const roots = new Map([[parsed.key, parsed.root]])
  seedStore(parsed.items, roots)
  const occ = expandRange(parsed.items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    .find(o => o.date === '2026-07-23')
  if (!occ) throw new Error('fixture occurrence missing')
  return renderHook(() => useEntryEditor(occ))
}

describe('single-writer editor invariants', () => {
  it('the fixture puts every watched field in the file', () => {
    // Guards the property below: a marker that was never written would make
    // invariant 2 vacuously true and the whole suite quietly useless.
    const { result } = freshEditor()
    act(() => { result.current.dialogHandlers.onPriority('high') })
    const written = persistence.contentByKey.get(testKey('plants')) ?? ''
    for (const marker of Object.values(WATCHED)) expect(written).toContain(marker)
  })

  it('no operation sequence reports a conflict or moves a field it did not name', () => {
    const warning = vi.spyOn(toast, 'warning').mockImplementation(() => '')
    try {
      fc.assert(
        fc.property(fc.array(fc.constantFrom(...OPS), { minLength: 1, maxLength: 6 }), ops => {
          warning.mockClear()
          const { result, unmount } = freshEditor()
          for (const op of ops) act(() => { op.run(result.current) })
          unmount()

          // Invariant 1 — nobody else is writing, so nothing can have conflicted.
          expect(warning, `sequence: ${ops.map(o => o.label).join(' → ')}`).not.toHaveBeenCalled()

          // Invariant 2 — an untouched field still holds what the fixture gave it.
          const written = persistence.contentByKey.get(testKey('plants'))
          if (written === undefined) return // nothing was saved; nothing to regress
          const named = new Set(ops.map(o => o.target))
          for (const [field, marker] of Object.entries(WATCHED) as Array<[Watched, string]>) {
            if (named.has(field)) continue
            expect(written, `${field} moved; sequence: ${ops.map(o => o.label).join(' → ')}`).toContain(marker)
          }
        }),
        // Enough to reach the four- and five-op sequences where the
        // interesting bugs lived, in about two seconds. The explicit timeout
        // is headroom for a slower CI runner, not an expectation.
        { numRuns: 1000 },
      )
    } finally {
      warning.mockRestore()
    }
  }, 30_000)

  /**
   * KNOWN DEFECT, found by the property above and pinned here rather than
   * dropped: **removing a repeat does nothing to a series.**
   *
   * `applyFieldsToItem` and `applyFuture` both read the incoming rule as
   * `repeat ?? existing`, because `applyScope` hands them a null `repeat` for
   * every 'single'/'add'-scope save and treating that as a deletion would wipe
   * a series whenever the user edited one of its occurrences. The cost is that
   * a null which really does mean "stop repeating" is swallowed with it: the
   * RepeatDialog's remove button (wired through `onRepeatRemove`) reports
   * success and the series keeps going.
   *
   * The property found it as `future → repeat:remove → repeat:3 days`, which
   * under the old form-and-base pair also poisoned everything after it: the
   * base advanced to the null the store had refused, so the next repeat edit
   * saw base null, the form's new rule and the store's old one, and reported a
   * conflict with nobody. A derived form cannot carry that damage — the next
   * render shows the repeat still there, which is at least honest — so
   * `repeat:remove` is back in `OPS` and only the no-op itself is left.
   *
   * Fixing it is a model change with a shape to decide, not an oversight: the
   * leg that stops repeating has to stop being a series, so `applyFuture` and
   * `applyAll` need to be able to emit a standalone occurrence and rehome the
   * override children hanging off the series. Short of that, an explicit intent
   * — distinguishing "no repeat at this scope" from "delete the repeat" —
   * would at least stop the silent no-op.
   *
   * `it.fails` on purpose: whoever fixes this gets a failing test telling them
   * to drop the `.fails`.
   */
  it.fails('removing a repeat stops the series repeating', () => {
    const { result } = freshEditor()
    act(() => { result.current.handleScopeChange('all') })
    act(() => { result.current.dialogHandlers.onRepeatRemove() })
    expect(persistence.contentByKey.get(testKey('plants')) ?? '').not.toContain('after_completion')
  })
})
