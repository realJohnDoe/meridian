/**
 * Root-A ratchet — see plans/health-survey-data-integrity-results.md §2 ("Root A —
 * the projection isn't required to be total") and the survey's Root B section.
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
 * non-root node and a container's own remainder (#5a/#5b, fixed), a save never
 * mixing line endings (#8, open) — as inline regressions, using `it.fails` for
 * the ones still open so CI stays green while the bug exists. THE POINT OF
 * `it.fails`: the moment the corresponding fix lands, this file goes red on its
 * own — flip that one case to `it` (removing `.fails`) as part of the fix's PR,
 * moving it from "known-open leaks" to "closed leaks" below. That flip is the
 * ratchet; #3's and #5's flips are what confirmed it actually ratchets (see
 * each finding's repro history) rather than just documenting a bug forever.
 *
 * Deliberately NOT here: #2 (clearing a field inherited from `defaults:`) is not
 * a load→save case — it only exists relative to an `applyEdit` call — so it falls
 * outside what an unedited-round-trip check can express. #2's own regression test
 * (health-survey-data-integrity-results.md finding #2) is what pins it instead.
 * #8 (CRLF) is pinned below by a narrower invariant than either check above — see
 * "mixed line endings", which does not conflict with AGENTS.md's declared
 * non-goal of normalising CRLF/blank-lines/quoting away.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { isSeries } from '@/types'
import { collectKeyValues, frontmatterOf, normalizeIds, serialize } from './helpers'

/** Check 1 — collapse totality. Store must survive its own serialization. */
function assertCollapseTotality(slug: string, source: string): void {
  const original = parseToStoreItems(`${slug}.md`, source)
  const reparsed = parseToStoreItems(`${slug}.md`, serialize(original.items, original.root))
  expect(normalizeIds(reparsed.items)).toEqual(normalizeIds(original.items))
}

/**
 * Check 2 — source fidelity. Every key/value pair the source had must survive an
 * UNEDITED save. Do not call this after an `applyEdit` — an intentional change
 * (e.g. `done: false` → `true`) reads as a "lost" pair and false-positives.
 */
function assertSourceFidelity(slug: string, source: string): void {
  const original = parseToStoreItems(`${slug}.md`, source)
  const saved = serialize(original.items, original.root)
  const before = new Set(collectKeyValues(frontmatterOf(source)))
  const after = new Set(collectKeyValues(frontmatterOf(saved)))
  const lost = [...before].filter(pair => !after.has(pair))
  expect(lost).toEqual([])
}

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
    const { items } = parseToStoreItems('inherited-vs-own-title.md', source)
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
    const parsed = parseToStoreItems('container-remainder.md', source)
    const saved = serialize(parsed.items, parsed.root)
    expect(frontmatterOf(saved).defaults).toEqual({ project: 'apollo', reviewer: 'alice' })
  })
})

describe('Root A totality — known-open leaks (documented, not yet fixed)', () => {
  // Finding #8 (narrow slice): AGENTS.md declares CRLF/blank-line normalisation a
  // deliberate non-goal, so this does NOT assert byte-identity. It asserts the one
  // part of #8 that isn't a normalisation choice: the output must not mix line
  // endings within one file (today the frontmatter is rewritten to LF while the
  // body's CRLF passes through untouched).
  it.fails('a save never mixes CRLF and bare LF in one file', () => {
    const source = '---\r\ntitle: A\r\ndate: 2026-01-01\r\n---\r\n\r\nline1\r\nline2\r\n'
    const original = parseToStoreItems('crlf.md', source)
    const saved = serialize(original.items, original.root)
    const hasCRLF = saved.includes('\r\n')
    const hasBareLF = /(?<!\r)\n/.test(saved)
    expect(hasCRLF && hasBareLF).toBe(false)
  })
})
