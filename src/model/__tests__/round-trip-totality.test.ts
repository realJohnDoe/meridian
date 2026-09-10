/**
 * Root-A ratchet. The data-integrity survey's §2 ("Root A — the projection
 * isn't required to be total") and its Root B section are where this came
 * from; that run's results file is gone now every finding is closed, so read
 * them in git history (`git log -- plans/data-integrity-results.md`).
 *
 * Every save regenerates a file from the store, so the store is only as faithful
 * as its ability to round-trip a source file's bytes. Two independent checks catch
 * different halves of that pipeline, and neither substitutes for the other:
 *
 *  - `collapseTotality` — does the store survive its own serialization?
 *    (parse → serialize → reparse ≟ parse, modulo random ids.) Fires when the
 *    STORE has the data but `collapse.ts` doesn't emit it (e.g. #3).
 *  - `sourceFidelity` — does every key/value pair the source had survive an
 *    unedited save? Fires when the STORE never had the data to begin with
 *    (e.g. #5). Only valid on an UNEDITED round trip — see the caveat below.
 *
 * These are the exact assertions already generalised over the fixture corpus in
 * `yaml-roundtrip.test.ts` ("preserves store structure across a round-trip") and
 * `unknown-keys.test.ts` ("no key loss") respectively. This file does not repeat
 * that sweep. It exists to pin the cases the corpus doesn't cover yet — an
 * excluded instance carrying metadata (#3, fixed), a file-level key on a
 * non-root node and a container's own remainder (#5a/#5b, fixed), a file's
 * line-ending/whitespace convention (#8, fixed) — as inline regressions, using
 * `it.fails` for any still open so CI stays green while the bug exists. THE
 * POINT OF `it.fails`: the moment the corresponding fix lands, this file goes
 * red on its own — flip that case to `it` (removing `.fails`) as part of the
 * fix's PR, moving it from "known-open leaks" to "closed leaks" below. That
 * flip is the ratchet; #3's, #5's and #8's flips are what confirmed it
 * actually ratchets (see each finding's repro history) rather than just
 * documenting a bug forever.
 *
 * Deliberately NOT here: #2 (clearing a field inherited from `defaults:`) is not
 * a load→save case — it only exists relative to an `applyEdit` call — so it falls
 * outside what an unedited-round-trip check can express. #2's own regression test
 * (2026-09-05 run, finding #2) is what pins it instead.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { roundTripLoss } from '@/model/roundTripCheck'
import { isSeries, isTracked } from '@/types'
import type { StoreItem, Entry } from '@/types'
import {
  fixtureNames, loadFixture, frontmatterOf, serialize, TEST_VAULT,
  assertCollapseTotality, assertSourceFidelity,
} from './helpers'

// ── The runtime guard itself ────────────────────────────────────────────────
//
// `roundTripLoss` is wired into `parseFiles`, so it runs over every file on
// every vault load and warns the user if a save would drop frontmatter. It is
// expected to never fire. That makes it exactly the kind of code that can rot
// into a no-op unnoticed, so these pin both directions: silent on every real
// file, and genuinely capable of detecting a loss.

describe('roundTripLoss — the runtime guard', () => {
  it.each(fixtureNames())('reports no loss for %s', (name) => {
    const source = loadFixture(name)
    const parsed = parseToStoreItems(`${name}.md`, source, TEST_VAULT)
    expect(roundTripLoss(`${name}.md`, source, parsed)).toEqual([])
  })

  // Non-vacuousness. Everything the survey found is fixed, so no real file
  // trips this any more — which means "it returns []" proves nothing on its
  // own. Feeding it a deliberately-lobotomised parse (the unknown-key bag
  // emptied, simulating a future collapse regression that stops emitting it)
  // proves the detector still detects.
  it('reports the missing keys when a save would genuinely drop them', () => {
    const source = [
      '---',
      'title: Quarterly review',
      'project: apollo',
      'date: 2026-04-08',
      '---',
    ].join('\n')
    const parsed = parseToStoreItems('qr.md', source, TEST_VAULT)
    const strip = (i: StoreItem): StoreItem => ({ ...i, metadata: { ...i.metadata, extra: undefined } })
    const [head, ...tail] = parsed.items
    const lobotomised: Entry = { ...parsed, items: [strip(head), ...tail.map(strip)] }
    expect(roundTripLoss('qr.md', source, lobotomised)).toEqual(['project=apollo'])
  })

  // Findings #5 and #6, both fixed — and these assert the SECOND one, which is
  // why they read as "reports nothing" rather than "reports a loss".
  //
  // #5 taught the guard to compare an unknown key by its source text, so a
  // value the parser flattened identically (a big integer past 2^53, a leading
  // zero, a leading `+`) stopped cancelling out and was reported. That made
  // these three cases *visible*; they were still corrupted on disk. #6 then
  // fixed the corruption itself — the save now reproduces the characters the
  // user wrote — so the guard has nothing left to report on them. If one of
  // these ever fails again, the value is being reformatted on save once more,
  // and the guard is the thing telling you so.
  it.each([
    ['a big integer',  'discord: 1234567890123456789'],
    ['a leading zero', 'zip: 01234'],
    ['a leading plus', 'phone: +49123456789'],
  ])('no longer reformats, so reports nothing, behind %s', (_name, line) => {
    const source = `---\ntitle: T\n${line}\n---\n`
    const parsed = parseToStoreItems('n.md', source, TEST_VAULT)
    expect(roundTripLoss('n.md', source, parsed)).toEqual([])
  })

  // #5's own machinery still needs a pin, and no real file can provide one any
  // more: every shape that used to be reformatted now survives. So this stages
  // the regression instead — it puts back the plain value the pipeline used to
  // carry, which is exactly what a future change dropping `RawScalar` would do,
  // and asserts the guard still catches it by source rather than by value.
  it('still detects a reformat by source when the authored form is dropped', () => {
    const source = '---\ntitle: T\nzip: 01234\n---\n'
    const parsed = parseToStoreItems('n.md', source, TEST_VAULT)
    const [head, ...tail] = parsed.items
    const flattened: Entry = {
      ...parsed,
      items: [{ ...head, metadata: { ...head.metadata, extra: { zip: 1234 } } }, ...tail],
    }
    expect(roundTripLoss('n.md', source, flattened)).toEqual(['zip=01234'])
  })

  // Finding #5, fixed (the other half): `date`/`time`/`repeat`/`excluded` used
  // to be skipped outright, so a save that dropped one of them was as invisible
  // as the value-level losses above. The guard now watches these keys too.
  //
  // No real file can demonstrate that any more. This used to feed it finding
  // #4's own repro (`date:` holding a list, which parsed cleanly and lost the
  // key on save); #4's fix refuses that file at the parse boundary instead, so
  // it never reaches the guard. So this stages the regression the same way the
  // `RawScalar` case above does — an item whose date the store simply doesn't
  // have, which is what a collapse that stopped emitting `date:` would produce
  // — and asserts the guard still names the key.
  it('detects a structural key a save would drop', () => {
    const source = '---\ntitle: T\ndate: 2026-04-08\n---\n'
    const parsed = parseToStoreItems('n.md', source, TEST_VAULT)
    const [head, ...tail] = parsed.items
    const undated: Entry = { ...parsed, items: [{ ...head, date: '' }, ...tail] }
    expect(roundTripLoss('n.md', source, undated)).toEqual(['date="2026-04-08"'])
  })
})

describe('Root A totality — closed leaks (regression guards)', () => {
  // Finding #3, fixed: excluding an occurrence used to discard every field it
  // carried, not just its visibility — serializeChildren emitted only
  // `date`/`time`/`excluded`. It now diffs the excluded child against the
  // series metadata like any other override, so un-excluding it restores what
  // was there rather than surfacing a blank slot.
  it('excluding a recurring occurrence keeps the metadata it carried', () => {
    const source = [
      '---',
      'title: Standup',
      'date: 2026-04-06',
      'repeat:',
      '  type: schedule',
      '  freq: weekly',
      '  byweekday: [mo]',
      'instances:',
      '  - date: 2026-04-13',
      '    excluded: true',
      '    cancelReason: public holiday',
      '---',
    ].join('\n')
    assertCollapseTotality('excluded-metadata', source)
    assertSourceFidelity('excluded-metadata', source)
  })

  // Finding #5a, fixed: a file-level key (title/tags/items) written on a
  // non-root node had nowhere to live — RESERVED_KEYS filtered it out of
  // `unknownKeys`, and it was never a typed occurrence field either, so it
  // landed in neither the occurrence's `extra` bag nor the file root's.
  // `extractItemMetadata` now rescues a non-root node's OWN (not inherited)
  // file-level keys into its `extra` — see storeItems.ts.
  it('a title written on a child instance survives the save', () => {
    const source = [
      '---',
      'instances:',
      '  - date: 2026-01-01',
      '    title: Meeting A',
      '  - date: 2026-01-02',
      '    title: Meeting B',
      '---',
    ].join('\n')
    assertCollapseTotality('title-on-instance', source)
    assertSourceFidelity('title-on-instance', source)
  })

  // Finding #5a, fixed — the case that makes the fix's "own, not inherited"
  // distinction load-bearing. A title inherited from the file root's own
  // `defaults:` block is a DIFFERENT mechanism (buildRoot's legacy-nesting
  // fallback already reads it directly) and must not be captured a second
  // time onto an override that never wrote its own title — only the override
  // that explicitly diverges should carry one.
  it('an override that merely inherits the series title carries no title of its own; one that diverges does', () => {
    const source = [
      '---',
      'defaults:',
      '  title: Original Title',
      'date: 2026-04-06',
      'time: "09:00"',
      'repeat:',
      '  type: schedule',
      '  freq: weekly',
      '  byweekday: [mo]',
      'instances:',
      '  - date: 2026-04-13',
      '    done: true',
      '  - date: 2026-04-20',
      '    title: Diverged Title',
      '---',
    ].join('\n')
    assertCollapseTotality('inherited-vs-own-title', source)
    assertSourceFidelity('inherited-vs-own-title', source)
    const { items } = parseToStoreItems('inherited-vs-own-title.md', source, TEST_VAULT)
    const inherited = items.find(i => !isSeries(i) && i.date === '2026-04-13')!
    const diverged  = items.find(i => !isSeries(i) && i.date === '2026-04-20')!
    expect(inherited.metadata.extra?.title).toBeUndefined()
    expect(diverged.metadata.extra?.title).toBe('Diverged Title')
  })

  // Finding #5b, fixed: a container node (no `date`, no `repeat`) never becomes
  // a StoreItem of its own, so any key written directly on it — `project:
  // apollo` on a nested grouping entry — had no `extra` bag to land in and was
  // silently deleted. `containerOwnRemainder` now carries a container's own
  // remainder down to its descendant items; since both descendants below carry
  // the identical value, `hoistSharedMetadata` collapses it back to a single
  // shared `defaults:` block — the same clean shape a user who wrote `project:
  // apollo` directly under `defaults:` would get.
  it('a container node\'s own keys survive, carried down to its descendant items', () => {
    const source = [
      '---',
      'title: Trip',
      'instances:',
      '  - project: apollo',
      '    reviewer: alice',
      '    instances:',
      '      - date: 2026-01-01',
      '      - date: 2026-01-02',
      '---',
    ].join('\n')
    assertCollapseTotality('container-remainder', source)
    assertSourceFidelity('container-remainder', source)
    const parsed = parseToStoreItems('container-remainder.md', source, TEST_VAULT)
    const saved = serialize(parsed.items, parsed.root)
    expect(frontmatterOf(saved).defaults).toEqual({ project: 'apollo', reviewer: 'alice' })
  })

  // Finding #8, fixed. `loadFile` used to `.trim()` the whole body (stripping
  // meaningful leading indentation along with the incidental blank line
  // Meridian's own separator inserts) and `wrapFrontmatter` hardcoded LF
  // regardless of source, guaranteeing mixed `\r\n`/`\n` output for any
  // CRLF-authored file. The fix turned out to do better than the narrow
  // "don't mix line endings" the report scoped it to — an unedited round trip
  // is now BYTE-IDENTICAL, not merely internally consistent, because the
  // body's own bytes were never the problem (they always passed through
  // untouched) and the structural glue now matches them instead of
  // overriding them.
  it('an unedited round trip is byte-identical: CRLF source', () => {
    const source = '---\r\ntitle: A\r\ndate: 2026-01-01\r\n---\r\n\r\nline1\r\nline2\r\n'
    const original = parseToStoreItems('crlf.md', source, TEST_VAULT)
    const saved = serialize(original.items, original.root)
    expect(saved).toBe(source)
    // The narrower invariant the report originally scoped this to, kept as an
    // explicit assertion in its own right: whatever else changes, a save must
    // never mix `\r\n` and bare `\n` in one file.
    expect(saved.includes('\r\n') && /(?<!\r)\n/.test(saved)).toBe(false)
  })

  // The report's other repro: leading indentation on the body's first line,
  // and a trailing blank line, both surviving a save that changed nothing.
  it('an unedited round trip is byte-identical: indented body, trailing blank line', () => {
    const source = '---\ntitle: A\n---\n\n  indented start\n\ncode:\n\n```\n  x = 1\n```\n\n\n'
    const original = parseToStoreItems('indented.md', source, TEST_VAULT)
    const saved = serialize(original.items, original.root)
    expect(saved).toBe(source)
  })

  // Finding #2a-ii, fixed — the parse half. `done: null` is how an occurrence
  // says "I am not a task" against a series whose `defaults:` makes every
  // occurrence one; an absent key would inherit `false` instead. It used to
  // survive as literal `null`, and `isTracked`'s `done !== undefined` then
  // reported it as a task — a third state that is neither done nor not-done,
  // reachable by hand-authoring long before the edit path could emit it.
  it('an explicit `done: null` reads back as untracked, not as a third state', () => {
    const source = [
      '---',
      'title: Standup',
      'date: 2026-04-06',
      'repeat:',
      '  type: schedule',
      '  freq: weekly',
      '  byweekday: [mo]',
      'defaults:',
      '  done: false',
      'instances:',
      '  - date: 2026-04-13',
      '    done: null',
      '---',
    ].join('\n')
    assertCollapseTotality('done-null', source)
    assertSourceFidelity('done-null', source)

    const { items } = parseToStoreItems('done-null.md', source, TEST_VAULT)
    const override = items.find(i => !isSeries(i) && i.date === '2026-04-13')!
    expect(override.metadata.done).toBeUndefined()
    expect(isTracked(override)).toBe(false)
  })

  // A brand-new entry has no source file to preserve a convention from — falls
  // back to Meridian's own default (LF, trailing newline) rather than throwing
  // or producing `undefined` anywhere in the output.
  it('a freshly-created entry with no fileConvention falls back to LF + trailing newline', () => {
    const created = parseToStoreItems('new.md', '---\ntitle: Fresh\ndate: 2026-01-01\n---\n', TEST_VAULT)
    const savedWithoutConvention = serialize(created.items, { ...created.root, fileConvention: undefined })
    expect(savedWithoutConvention.includes('\r')).toBe(false)
    expect(savedWithoutConvention.endsWith('\n')).toBe(true)
  })

  // #1011, fixed. `fileMetaToYaml` used to decide what to omit with
  // `inlineFieldEmpty`, a function of the value alone — `''` is not "empty"
  // for a `string` kind, so the required `title` field always wrote
  // `title: ""` for a note with no title, which is every frontmatter-less
  // note. It now uses the same relational rule `occMetaToYaml` already uses
  // for occurrence fields: omit a field only when its value round-trips to
  // what omitting it gives back (`absentFieldValue`). A hand-authored plain
  // Markdown note therefore keeps no frontmatter at all until a field is
  // actually set — the README's promise that such a file is picked up
  // unmodified.
  it('a hand-authored note with no frontmatter gets none written back', () => {
    const source = 'Just some body text.\n'
    const original = parseToStoreItems('plain.md', source, TEST_VAULT)
    const saved = serialize(original.items, original.root)
    expect(saved).toBe(source)
    expect(saved.startsWith('---')).toBe(false)
  })

  // An entirely empty file (no frontmatter, no body) must not grow an empty
  // `---`/`---` fence around nothing — `serializeRawNode` returns '' rather
  // than letting the `yaml` package stringify `{}` into the file.
  it('an entirely empty file stays empty rather than growing an empty frontmatter fence', () => {
    const original = parseToStoreItems('empty.md', '', TEST_VAULT)
    expect(serialize(original.items, original.root)).toBe('')
  })

  // The other side of the same rule: once the note actually holds a field,
  // frontmatter appears — carrying only what was set, nothing more.
  it('a frontmatter-less note that gains a title gets frontmatter carrying only that field', () => {
    const source = 'Just some body text.\n'
    const original = parseToStoreItems('plain.md', source, TEST_VAULT)
    const saved = serialize(original.items, { ...original.root, title: 'My Note' })
    expect(frontmatterOf(saved)).toEqual({ title: 'My Note' })
  })
})

// `archived` (plans/archived-entries.md PR 1) is the first FILE-LEVEL boolean
// in the registry. It is not `required`, so its absent-value default is
// `undefined`, not `false` — unlike `done` this field can be written `false`
// by hand and must keep round-tripping as `false`, never "fixed" into a
// required field with an empty-array-style default. These three pin the trap
// PR 2's unarchive action depends on: it must clear the key, not write `false`.
describe('archived field (plans/archived-entries.md PR 1)', () => {
  it('archived: true survives an unedited round trip', () => {
    const source = '---\ntitle: Old Project\narchived: true\n---\n'
    assertCollapseTotality('archived-true', source)
    assertSourceFidelity('archived-true', source)
  })

  // A hand-written `false` is a real, distinct value — not the same as the
  // key being absent — and must round-trip exactly like any other field.
  it('archived: false survives an unedited round trip', () => {
    const source = '---\ntitle: Explicitly Not Archived\narchived: false\n---\n'
    assertCollapseTotality('archived-false', source)
    assertSourceFidelity('archived-false', source)
    const { root } = parseToStoreItems('archived-false.md', source, TEST_VAULT)
    expect(root.archived).toBe(false)
  })

  it('a file with no archived key still emits none', () => {
    const source = '---\ntitle: Ordinary Note\n---\n'
    const parsed = parseToStoreItems('ordinary.md', source, TEST_VAULT)
    expect(parsed.root.archived).toBeUndefined()
    expect(frontmatterOf(serialize(parsed.items, parsed.root))).not.toHaveProperty('archived')
  })

  // The trap: unarchiving must clear the key (`undefined`), never write
  // `false` — a non-required boolean's absent-value default is `undefined`,
  // so a written `false` would round-trip forever as "explicitly not
  // archived" rather than reading identically to a file that never had the key.
  it('clearing archived (unarchiving) emits no archived key, not archived: false', () => {
    const source = '---\ntitle: Old Project\narchived: true\n---\n'
    const parsed = parseToStoreItems('unarchive.md', source, TEST_VAULT)
    const unarchived = serialize(parsed.items, { ...parsed.root, archived: undefined })
    expect(frontmatterOf(unarchived)).not.toHaveProperty('archived')

    const reparsed = parseToStoreItems('unarchive.md', unarchived, TEST_VAULT)
    expect(reparsed.root.archived).toBeUndefined()
  })
})
