/**
 * fast-check property suite for `mergeFileContent` on series files (#1222).
 *
 * Both sides start from one generated series and make the edits a user makes
 * from the agenda and the editor — tick, a single-occurrence priority change,
 * a `future` split — through the real store ops, so the instance shapes are
 * the ones the app writes. The oracle is stated over the expansion, not bytes:
 * per occurrence date and per field, a side that left a value alone has no
 * opinion about it (`merge.ts`'s rule, applied to what the user sees).
 *
 *  - Safety: whenever the merge returns a file, its expansion is exactly that
 *    three-way union. A tick merged under a leg that no longer generates its
 *    date — the split-vs-tick race the issue warns about — vanishes from the
 *    expansion and fails here.
 *  - Liveness: when neither side changed the series' shape (a split, or a
 *    rule or anchor edit at scope `all`), the base has no two instances on one
 *    date, and the union has no conflict, the merge must not fall back to a
 *    conflict copy. After a shape change a copy is always
 *    allowed; it is the safe answer, not a lost update.
 *
 * CI pins `seed`/`numRuns`; roam locally by raising `numRuns` and dropping
 * `seed`, and turn any find into an example test in `merge.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { TEST_VAULT, NEW_TARGET, dataOf, rootsOf, itemsOf, rootsIn, serializeOnly, frontmatterOf } from './helpers'
import { applyEdit, toggleDone } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { parseToStoreItems } from '@/model/storeItems'
import { changedEditFields, mergeFileContent, sameValue } from '@/model/merge'
import { expandRange } from '@/model/expansion'
import type { EditScope, Occurrence } from '@/types'

const FROM = new Date('2026-03-01')
const TO   = new Date('2026-04-30')

const parse = (source: string): StoreData => {
  const { items, root } = parseToStoreItems('generated.md', source, TEST_VAULT)
  return dataOf(items, rootsOf(root))
}
const expand = (data: StoreData): Occurrence[] => expandRange(itemsOf(data), rootsIn(data), FROM, TO)

const render = (freq: string) =>
  `---\ntitle: Run\ndate: 2026-03-02\ndone: false\nrepeat:\n  type: schedule\n  freq: ${freq}\n---\n`

type Op =
  | { kind: 'tick'; idx: number }
  | { kind: 'priority'; idx: number; value: 'high' | 'low' }
  | { kind: 'split'; idx: number; title: string }
  | { kind: 'rule'; interval: number; shift: number }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('tick' as const), idx: fc.nat(40) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('priority' as const), idx: fc.nat(40), value: fc.constantFrom('high' as const, 'low' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('split' as const), idx: fc.nat(40), title: fc.constantFrom('Jog', 'Sprint') }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('rule' as const), interval: fc.constantFrom(1, 2), shift: fc.constantFrom(0, 1) }) },
)
const reshapes = (op: Op) => op.kind === 'split' || op.kind === 'rule'

/** What the editor's form holds for `occ` at `scope` — cf. `edit-generated.test.ts`'s `formFor`. */
function formFor(occ: Occurrence, data: StoreData, scope: EditScope): EditFields {
  const series = itemsOf(data).find(i => 'repeat' in i && i.id === occ.ownerId)
  const m = series && scope !== 'single' ? { ...occ.metadata, ...series.metadata, done: occ.metadata.done } : occ.metadata
  return {
    title: m.title, tags: m.tags, items: m.items, participants: m.participants,
    body: m.body ?? '', tracked: m.done !== undefined, done: m.done ?? false,
    priority: m.priority ?? null,
    scheduled: scope === 'all' && series ? { date: series.date, time: series.time ?? '' } : { date: occ.date, time: occ.time ?? '' },
    duration: m.duration ?? '', repeat: scope === 'all' && series && 'repeat' in series ? series.repeat : null,
  }
}

function apply(data: StoreData, op: Op): StoreData {
  const occs = expand(data)
  const occ = occs[op.kind === 'rule' ? 0 : op.idx % occs.length]!
  if (op.kind === 'tick') return toggleDone(data, occ)
  const scope: EditScope = op.kind === 'split' ? 'future' : op.kind === 'rule' ? 'all' : 'single'
  const form = formFor(occ, data, scope)
  const fields = op.kind === 'split' ? { ...form, title: op.title }
    : op.kind === 'rule' ? {
      ...form,
      // Always a schedule rule here: `render` writes no other kind.
      repeat: form.repeat?.type === 'schedule' ? { ...form.repeat, interval: op.interval } : form.repeat,
      scheduled: { ...form.scheduled!, date: addDays(form.scheduled!.date, op.shift) },
    }
    : { ...form, priority: op.value }
  return applyEdit(data, occ, scope, fields, NEW_TARGET, changedEditFields(form, fields))
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** An occurrence as the user sees it, keyed by date — no moves, so a date is a slot. */
type View = Map<string, { title?: string; done: boolean; priority: string | undefined }>
const view = (source: string): View => new Map(expand(parse(source)).map(o =>
  [o.date, { title: o.metadata.title, done: !!o.metadata.done, priority: o.metadata.priority }]))

/**
 * The three-way union per date and field; null where both sides moved one
 * value apart. Whether a date exists at all is decided on the per-occurrence
 * fields alone: a series-wide rename has no opinion about one date the other
 * side's rule dropped, but a tick on it does. Such a date's title is left out
 * (`undefined`), since which leg's title it gets is the series' business.
 */
function union(b: View, l: View, r: View): View | null {
  const pick = <T,>(base: T, local: T, remote: T): { v: T } | null => {
    const lm = !sameValue(base, local), rm = !sameValue(base, remote)
    if (lm && rm && !sameValue(local, remote)) return null
    return { v: lm ? local : remote }
  }
  const out: View = new Map()
  for (const date of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const [bs, ls, rs] = [b.get(date), l.get(date), r.get(date)]
    if (!bs || !ls || !rs) {
      const occ = (s?: { done: boolean; priority?: string }) => s && { done: s.done, priority: s.priority }
      const p = pick(occ(bs), occ(ls), occ(rs))
      if (!p) return null
      if (p.v) out.set(date, p.v)
      continue
    }
    const title = pick(bs.title, ls.title, rs.title)
    const done = pick(bs.done, ls.done, rs.done)
    const priority = pick(bs.priority, ls.priority, rs.priority)
    if (!title || !done || !priority) return null
    out.set(date, { title: title.v, done: done.v, priority: priority.v })
  }
  return out
}

/** A base the merge refuses by design: two instances share a date, so neither has an identity. */
function duplicateDates(source: string): boolean {
  const dates = ((frontmatterOf(source).instances ?? []) as Array<{ date: unknown }>).map(i => String(i.date))
  return new Set(dates).size !== dates.length
}

const caseArb = fc.record({
  freq: fc.constantFrom('daily', 'weekly'),
  // The shared history: ticks, and possibly a split, so legs are in the base.
  history: fc.array(opArb, { maxLength: 3 }),
  local: fc.array(opArb, { maxLength: 2 }),
  remote: fc.array(opArb, { maxLength: 2 }),
})

describe('mergeFileContent — generated series edits (#1222)', () => {
  it('a merged file expands to the union of both sides; only a shape change may force a copy', () => {
    fc.assert(
      fc.property(caseArb, ({ freq, history, local, remote }) => {
        const base = serializeOnly(history.reduce(apply, parse(render(freq))))
        const side = (ops: Op[]) => serializeOnly(ops.reduce(apply, parse(base)))
        const [l, r] = [side(local), side(remote)]

        const expected = union(view(base), view(l), view(r))
        const merged = mergeFileContent('generated.md', base, l, r)

        if (merged !== null) {
          expect(expected).not.toBeNull()
          const actual = view(merged)
          for (const [date, slot] of expected!) if (!('title' in slot)) delete actual.get(date)?.title
          expect(actual).toEqual(expected)
        } else if (![...local, ...remote].some(reshapes) && !duplicateDates(base)) {
          expect(expected).toBeNull()
        }
      }),
      { seed: 20261031, numRuns: 300 },
    )
  })
})
