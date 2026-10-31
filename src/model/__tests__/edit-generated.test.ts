/**
 * fast-check property suite for `applyEdit` (issue #1176): generates
 * (series shape, occurrence, scope, field edit) and asserts invariants over
 * the expansion before and after.
 *
 * Every one of the scope bugs fixed in the seven weeks before this file
 * (duplicate from a split at the anchor, duplicate from a same-day time move,
 * after_completion anchor not suppressed on move, done lost on an in-session
 * move, …) landed with a hand-written example test written after it reached
 * `main` — the same "a shape nobody wrote down" argument
 * `round-trip-generated.test.ts` makes for parse/serialise, and the same
 * remedy: a structured record `.map()`ped to file text, so shrinking keeps it
 * parseable and a counterexample renders straight into a fixture.
 *
 * The invariants are deliberately per-scope, because each scope breaks the
 * naive "nothing else changed" rule on purpose: `add` creates an occurrence,
 * `future` splits a series, `single` moves one slot. What they share is an
 * accounting rule — the expansion after the edit is the expansion before it
 * with exactly the change the scope promises, no more — which is what every
 * duplicate-occurrence bug violated. On top of that:
 *  - the edited state survives `serializeEntry` → `parseToStoreItems`, so the
 *    edit is tied to the existing round-trip guarantee;
 *  - a second save in the same editor session lands where saving the final
 *    fields once would (the stale-owner bugs only show on the second save),
 *    whether the editor followed the occurrence or replayed a queued save
 *    with the occurrence it had pinned before the first one landed.
 *
 * Exclusions, each a designed behaviour rather than a gap:
 *  - `done` is edited only at scope `single` and never on an after_completion
 *    series: completing one generates the next occurrence by design.
 *  - an after_completion series is only edited at its projected (last)
 *    occurrence: moving a completed one re-projects the next.
 *  - a move (or an `add`) never lands on a slot another occurrence already
 *    holds: that slot's override key is the recurrence id, so the two are one row.
 *
 * CI pins `seed`/`numRuns`; roam locally by raising `numRuns` and dropping
 * `seed`, and turn any find into an example test in `edits.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { TEST_VAULT, NEW_TARGET, dataOf, rootsOf, itemsOf, rootsIn, serializeOnly } from './helpers'
import { applyEdit, toggleDone } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { parseToStoreItems } from '@/model/storeItems'
import { changedEditFields } from '@/model/merge'
import { expandRange } from '@/model/expansion'
import type { EditScope, Occurrence, Priority } from '@/types'

// ── Series shapes ──────────────────────────────────────────────────────────

const FROM = new Date('2026-03-01')
const TO   = new Date('2026-05-31')

type RepeatShape =
  | { kind: 'weekly' }
  | { kind: 'weekdays' }      // mo + th: two slots a week
  | { kind: 'daily'; interval: number }
  | { kind: 'afterCompletion' }

interface Override { idx: number; kind: 'done' | 'priority' | 'excluded' }

interface Shape {
  repeat: RepeatShape
  date: string
  time: string | null
  /** A task (`done: false` on the root) rather than an event. */
  tracked: boolean
  priority: Priority | null
  /** schedule series: instances written into the file. */
  overrides: Override[]
  /** after_completion: how many leading occurrences are ticked off first. */
  completed: number
}

const shapeArb: fc.Arbitrary<Shape> = fc.record({
  repeat: fc.oneof(
    fc.constant<RepeatShape>({ kind: 'weekly' }),
    fc.constant<RepeatShape>({ kind: 'weekdays' }),
    fc.integer({ min: 2, max: 3 }).map((interval): RepeatShape => ({ kind: 'daily', interval })),
    fc.constant<RepeatShape>({ kind: 'afterCompletion' }),
  ),
  date: fc.constantFrom('2026-03-09', '2026-03-12', '2026-03-16'),
  time: fc.constantFrom(null, '09:00'),
  tracked: fc.boolean(),
  priority: fc.constantFrom(null, 'medium' as const),
  overrides: fc.array(
    fc.record({ idx: fc.nat(12), kind: fc.constantFrom<Override['kind']>('done', 'priority', 'excluded') }),
    { maxLength: 2 },
  ),
  completed: fc.oneof(fc.constant(0), fc.nat(2)),
})

function renderRepeat(r: RepeatShape): string[] {
  switch (r.kind) {
    case 'weekly':          return ['  type: schedule', '  freq: weekly']
    case 'weekdays':        return ['  type: schedule', '  freq: weekly', '  byweekday: [mo, th]']
    case 'daily':           return ['  type: schedule', '  freq: daily', `  interval: ${r.interval}`]
    case 'afterCompletion': return ['  type: after_completion', '  interval: 1 week']
  }
}

function render(shape: Shape, instances: string[]): string {
  return [
    '---',
    'title: "Generated"',
    `date: ${shape.date}`,
    ...(shape.time ? [`time: ${shape.time}`] : []),
    // An untracked after_completion series has nothing to complete.
    ...(shape.tracked || shape.repeat.kind === 'afterCompletion' ? ['done: false'] : []),
    ...(shape.priority ? [`priority: ${shape.priority}`] : []),
    'repeat:',
    ...renderRepeat(shape.repeat),
    ...(instances.length ? ['instances:', ...instances] : []),
    '---',
  ].join('\n')
}

function parse(source: string): StoreData {
  const { items, root } = parseToStoreItems('generated.md', source, TEST_VAULT)
  return dataOf(items, rootsOf(root))
}

const expand = (data: StoreData): Occurrence[] => expandRange(itemsOf(data), rootsIn(data), FROM, TO)

/**
 * The shape as store data. Schedule overrides are written into the file — the
 * dates they sit on come from expanding the bare rule first, so an override
 * always lands on a slot the rule produces. after_completion history is made
 * the way the app makes it, by ticking occurrences off with `toggleDone`.
 */
function build(shape: Shape): StoreData {
  const bare = parse(render(shape, []))
  if (shape.repeat.kind === 'afterCompletion') {
    let data = bare
    for (let i = 0; i < shape.completed; i++) {
      const open = expand(data).find(o => !o.metadata.done)
      if (open) data = toggleDone(data, open)
    }
    return data
  }
  const dates = expand(bare).map(o => o.date)
  const lines = shape.overrides.flatMap(({ idx, kind }) => {
    const date = dates[idx % dates.length]!
    const field = kind === 'done' ? 'done: true' : kind === 'priority' ? 'priority: high' : 'excluded: true'
    return [`  - date: ${date}`, `    ${field}`]
  })
  return parse(render(shape, lines))
}

// ── Edits ───────────────────────────────────────────────────────────────────

type Change =
  | { kind: 'priority'; value: Priority | null }
  | { kind: 'title'; value: string }
  | { kind: 'done' }
  | { kind: 'move'; days: number; time: string }

const priorityArb = fc.constantFrom<Priority | null>('high', 'low', null).map((value): Change => ({ kind: 'priority', value }))
const titleArb = fc.constantFrom('Renamed', 'Other').map((value): Change => ({ kind: 'title', value }))
// Never a bare `time: null`: on a timed series an untimed child inherits the
// series' time (`inheritance.ts`), so "no time" isn't a slot a move can name.
const moveArb = fc.record({ days: fc.integer({ min: -2, max: 2 }), time: fc.constantFrom('09:00', '10:30') })
  .map((m): Change => ({ kind: 'move', ...m }))

function changeArb(scope: EditScope, afterCompletion: boolean): fc.Arbitrary<Change> {
  if (scope === 'single') return afterCompletion
    ? fc.oneof(priorityArb, titleArb, moveArb)
    : fc.oneof(priorityArb, titleArb, moveArb, fc.constant<Change>({ kind: 'done' }))
  return fc.oneof(priorityArb, titleArb)
}

/** What the editor's form holds for `occ` at `scope` (cf. `editor/save.ts`'s `applyScope`). */
function formFor(occ: Occurrence, data: StoreData, scope: EditScope): EditFields {
  const series = itemsOf(data).find(i => 'repeat' in i && i.id === occ.ownerId)
  // At all/future the form shows the series' own values, not the override's.
  const m = series && scope !== 'single' && scope !== 'add' ? { ...occ.metadata, ...series.metadata, done: occ.metadata.done } : occ.metadata
  const scheduled = scope === 'all' && series
    ? { date: series.date, time: series.time ?? '' }
    : { date: occ.date, time: occ.time ?? '' }
  return {
    title: m.title, tags: m.tags, items: m.items, participants: m.participants,
    body: m.body ?? '', tracked: m.done !== undefined, done: m.done ?? false,
    priority: m.priority ?? null, scheduled, duration: m.duration ?? '', repeat: null,
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function withChange(f: EditFields, c: Change): EditFields {
  switch (c.kind) {
    case 'priority': return { ...f, priority: c.value }
    case 'title':    return { ...f, title: c.value }
    case 'done':     return { ...f, tracked: true, done: !f.done }
    case 'move':     return { ...f, scheduled: { date: addDays(f.scheduled!.date, c.days), time: c.time } }
  }
}

// ── Views ───────────────────────────────────────────────────────────────────

/** An occurrence as the user sees it — ids are random per split, so they're left out. */
const slot = (o: { date: string; time: string | null }): string => `${o.date} ${o.time ?? '--:--'}`
const view = (o: Occurrence): string => `${slot(o)} done=${!!o.metadata.done} prio=${o.metadata.priority ?? '-'}`
const views = (occs: Occurrence[]): string[] => occs.map(view).sort()
const titled = (occs: Occurrence[]): string[] => occs.map(o => `${view(o)} ${o.metadata.title}`).sort()

/**
 * The occurrence an open editor holds after a save — `EntryReady`'s
 * `occurrenceById`, then `firstFrom`'s fallback when a split re-keyed it.
 */
function follow(data: StoreData, pinned: Occurrence): Occurrence {
  const stored = itemsOf(data).find(i => !('repeat' in i) && i.id === pinned.id && !i.excluded)
  const day = stored?.date || pinned.date
  const occs = expand(data)
  return occs.find(o => o.date === day && o.id === pinned.id)
    ?? occs.find(o => o.date >= pinned.date)
    ?? pinned
}

// ── Property ────────────────────────────────────────────────────────────────

const caseArb = shapeArb.chain(shape => {
  const ac = shape.repeat.kind === 'afterCompletion'
  return fc.constantFrom<EditScope>('single', 'future', 'all', 'add').chain(scope => fc.record({
    shape: fc.constant(shape),
    scope: fc.constant(scope),
    // The series' own anchor and a stored override are where the split-at-anchor
    // and stale-owner bugs lived; a uniform pick almost never lands on either.
    pick: fc.oneof(fc.constantFrom<'anchor' | 'override'>('anchor', 'override'), fc.nat(40)),
    change: scope === 'add' ? moveArb : changeArb(scope, ac),
    second: changeArb(scope, ac),
  }))
})

describe('applyEdit — generated (issue #1176)', () => {
  it('changes exactly what the scope promises, survives a round trip, and absorbs a second save', () => {
    fc.assert(
      fc.property(caseArb, ({ shape, scope, pick, change, second }) => {
        const data = build(shape)
        const before = expand(data)
        const ac = shape.repeat.kind === 'afterCompletion'
        const visible = ac ? before.filter(o => !o.metadata.done) : before
        fc.pre(visible.length > 0)
        // Keep the edited occurrence and anywhere it moves well inside the
        // window, so nothing slides across an edge of the expansion.
        const inner = visible.filter(o => o.date >= '2026-03-05' && o.date <= '2026-05-20')
        fc.pre(inner.length > 0)
        const occ = ac ? inner[inner.length - 1]!
          : pick === 'anchor' ? inner[0]!
          : pick === 'override' ? inner.find(o => itemsOf(data).some(i => i.id === o.id)) ?? inner[0]!
          : inner[pick % inner.length]!

        // The editor never offers 'future' on an after_completion series
        // (`EntryEditor.tsx`'s scope select), so it has no split to check.
        if (scope === 'future') fc.pre(!ac)
        const form = formFor(occ, data, scope)
        const fields = withChange(form, change)
        const target = { date: fields.scheduled!.date, time: fields.scheduled!.time || null }
        if (scope === 'add' || slot(target) !== slot(occ)) fc.pre(!before.some(o => slot(o) === slot(target)))

        const after = applyEdit(data, occ, scope, fields, NEW_TARGET, scope === 'add' ? undefined : changedEditFields(form, fields))
        const occsAfter = expand(after)
        const edited = view({ ...occ, ...target, metadata: { ...occ.metadata, ...(fields.tracked ? { done: fields.done } : {}), priority: fields.priority ?? undefined } })

        // 1. Accounting: exactly the scope's change, nothing else.
        const others = (occs: Occurrence[]) => views(occs.filter(o => slot(o) !== slot(target)))
        switch (scope) {
          case 'single':
            expect(views(occsAfter)).toEqual(views(before.filter(o => o.id !== occ.id)).concat(edited).sort())
            break
          case 'add':
            expect(occsAfter).toHaveLength(before.length + 1)
            expect(others(occsAfter)).toEqual(others(before))
            break
          case 'all':
          case 'future': {
            const covered = (o: { date: string }) => scope === 'all' || o.date >= occ.date
            const prio = change.kind === 'priority' ? change.value : undefined
            // An override's own priority wins over the series' change (#1191).
            const inherits = (o: Occurrence) => o.metadata.priority === (shape.priority ?? undefined)
            const expected = before.map(o => !covered(o) || prio === undefined || !inherits(o) ? view(o) : view({ ...o, metadata: { ...o.metadata, priority: prio ?? undefined } }))
            expect(views(occsAfter)).toEqual(expected.sort())
          }
        }
        if (change.kind === 'title') expect(occsAfter.every(o => o.metadata.title === change.value)).toBe(true)

        // 2. The edited state is what lands on disk.
        expect(titled(expand(parse(serializeOnly(after))))).toEqual(titled(occsAfter))

        // 3. A queued save replayed with the pre-save occurrence changes nothing more.
        if (scope !== 'add') {
          const replay = applyEdit(after, occ, scope, fields, NEW_TARGET, changedEditFields(form, fields))
          expect(serializeOnly(replay)).toBe(serializeOnly(after))
        }

        // 4. A second save from the same session ≡ saving its fields once.
        if (scope !== 'add') {
          const fields2 = withChange(fields, second)
          const t2 = changedEditFields(form, fields2)
          const final = slot(fields2.scheduled ? { date: fields2.scheduled.date, time: fields2.scheduled.time || null } : occ)
          fc.pre(final === slot(occ) || !before.some(o => slot(o) === final))
          const twice = applyEdit(after, follow(after, occ), scope, fields2, NEW_TARGET, t2)
          const once = applyEdit(data, occ, scope, fields2, NEW_TARGET, t2)
          expect(serializeOnly(twice)).toBe(serializeOnly(once))
        }
      }),
      { seed: 20261030, numRuns: 200 },
    )
  })
})
