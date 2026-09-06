/**
 * Data-integrity survey, finding #4 — a structural key written in a shape the
 * model cannot read.
 *
 * The six `STRUCTURAL_KEYS` are the one part of the frontmatter vocabulary with
 * no fallback home. An unknown key rides in `extra`; a registry key written in
 * the wrong shape rides there too (`malformedKnownFields`) and wins back on
 * emission. A structural key does neither — `RESERVED_KEYS` keeps it out of
 * `extra` on purpose, since an `extra.date` re-emitted beside the model's own
 * would give the file two disagreeing schedules. So before this fix, a
 * wrong-shaped structural value read back as "absent" and the next save wrote
 * the file without it: the entry's schedule, its override list, or a
 * deliberate exclusion silently deleted, and a scalar `defaults:` spread
 * character by character into ten garbage keys.
 *
 * The chosen answer is refusal, not repair. Meridian never writes to a file it
 * could not load, so a file that lands in `unreadableFiles` keeps its bytes
 * exactly as typed while the user is told which key is wrong and where. The
 * alternative — carrying the value in a structural remainder — means guessing
 * a schedule from a value the model could not read and emitting it beside the
 * one it computed, which is a silent rewrite of the user's file: the failure
 * this finding is about, in a new place.
 *
 * The `roundTripLoss` guard is not the safety net here and cannot be: it
 * reports, and a report the user must act on before the next save is a race
 * they lose. It stays covered in `round-trip-totality.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { STRUCTURAL_KEYS, structuralShapeErrors } from '@/model/fieldRegistry'
import { serialize, TEST_VAULT } from './helpers'

/** A whole file around one frontmatter fragment — the survey's own repro shape. */
const file = (frag: string): string =>
  `---\ntitle: Note\n${frag}\nproject: apollo\n---\n\nBody.\n`

const parse = (frag: string): ReturnType<typeof parseToStoreItems> =>
  parseToStoreItems('note.md', file(frag), TEST_VAULT)

describe('malformed structural keys are refused, not silently dropped', () => {
  // The survey's six repro files, verbatim. Each one used to parse cleanly and
  // lose the key on the next save; the last one used to *add* ten keys.
  it.each([
    ['date as a list',          'date:\n  - 2026-04-08',            "'date' must be a single value, not a list"],
    ['date as a mapping',       'date:\n  start: 2026-04-08',       "'date' must be a single value, not a block of keys"],
    ['time as a list',          'date: 2026-04-08\ntime:\n  - "09:00"', "'time' must be a single value, not a list"],
    ['excluded as a string',    'date: 2026-04-08\nexcluded: "yes"', "'excluded' must be true or false, not text"],
    ['instances as a mapping',  'date: 2026-04-08\ninstances:\n  a: 1', "'instances' must be a list of entries, not a block of keys"],
    ['defaults as a scalar',    'date: 2026-04-08\ndefaults: everything', "'defaults' must be a block of keys, not text"],
  ])('refuses %s, naming the key', (_name, frag, message) => {
    expect(() => parse(frag)).toThrow(message)
  })

  // `repeat` used to survive by luck — `collapseToYaml` copies it through
  // verbatim — while producing a series that generates nothing. Luck is not
  // coverage: it is refused on the same rule as the other five.
  it('refuses a scalar repeat, which used to survive as a series that generates nothing', () => {
    expect(() => parse('date: 2026-04-08\nrepeat: weekly')).toThrow("'repeat' must be a block of keys, not text")
  })

  // A list element that is not a mapping hits `buildEffectiveTree`'s
  // `Object.entries(child)`, which explodes a string into {0: 'f', 1: 'o', …}
  // exactly as the scalar `defaults:` case does.
  it('refuses an instances list whose elements are not entries', () => {
    expect(() => parse('instances:\n  - just-a-string')).toThrow("'instances' must be a list of entries, not a list")
  })

  it('says where the bad key is, not just which one', () => {
    expect(() => parse('instances:\n  - date: 2026-04-08\n  - date:\n      - 2026-04-09'))
      .toThrow("'date' must be a single value, not a list (at instances[1])")
    expect(() => parse('defaults:\n  excluded: nope\ninstances:\n  - date: 2026-04-08'))
      .toThrow("'excluded' must be true or false, not text (at defaults)")
  })

  it('reports every bad key at once, capped so one file cannot flood the toast', () => {
    const problems = structuralShapeErrors({
      date: ['x'], time: ['x'], excluded: 'yes', repeat: 'weekly', instances: { a: 1 },
    })
    expect(problems).toHaveLength(5)
    expect(() => parse('date:\n  - x\ntime:\n  - x\nexcluded: yes\nrepeat: weekly'))
      .toThrow('(+1 more)')
  })
})

describe('what is NOT malformed', () => {
  // The refusal must be narrow: it exists to stop a silent deletion, not to
  // start rejecting files that load fine today. An explicit YAML `null` is how
  // a node overrides an inherited value with nothing — the same reading
  // `parseInlineField` gives it for typed fields — so it is a value, not a
  // wrong shape.
  it.each([
    ['a null date',       'date: null'],
    ['an empty date',     'date:'],
    ['an empty time',     'date: 2026-04-08\ntime:'],
    ['an empty defaults', 'date: 2026-04-08\ndefaults:'],
    ['an empty instances','date: 2026-04-08\ninstances:'],
    ['an empty list of instances', 'date: 2026-04-08\ninstances: []'],
    ['excluded: false',   'date: 2026-04-08\nexcluded: false'],
    ['a numeric date',    'date: 2026'],
    ['a quoted time',     'date: 2026-04-08\ntime: "09:00"'],
    ['an empty defaults block', 'date: 2026-04-08\ndefaults: {}'],
  ])('still loads %s', (_name, frag) => {
    expect(() => parse(frag)).not.toThrow()
  })

  // The keys are structural only where the model reads them — at a node. The
  // same words inside an unknown key's own value are somebody else's data and
  // ride through `extra` untouched.
  it('ignores the same words nested inside an unknown key', () => {
    const frag = 'date: 2026-04-08\nshipping:\n  date:\n    - 2026-05-01\n  instances: nope'
    const parsed = parse(frag)
    expect(serialize(parsed.items, parsed.root)).toContain('- 2026-05-01')
  })

  // Every fixture in the corpus is a file Meridian itself can write, so the
  // check has to be silent across all of them — this is the "did I just make
  // real files unreadable?" question, asked of the whole suite at once.
  it('accepts every file the model already round-trips', async () => {
    const { fixtureNames, loadFixture } = await import('./helpers')
    for (const name of fixtureNames()) {
      expect(() => parseToStoreItems(`${name}.md`, loadFixture(name), TEST_VAULT)).not.toThrow()
    }
  })
})

describe('the shape table covers the vocabulary', () => {
  // A seventh structural key added without a shape would be checked by
  // nothing, and would fail exactly the way these six did. `structuralShapeErrors`
  // reads its table by key, so the only way to pin the coverage is to feed it
  // one obviously-wrong value per key and require a complaint about each.
  it('has a rule for every STRUCTURAL_KEYS member', () => {
    for (const key of STRUCTURAL_KEYS) {
      // A list of scalars is wrong for all six shapes at once — wrong for the
      // two scalars, not a mapping, and not a list of *entries* — so whatever
      // this key's rule is it must complain, unless there is no rule at all.
      const problems = structuralShapeErrors({ [key]: ['x'] })
      expect(problems, `no shape rule for structural key '${key}'`).toHaveLength(1)
    }
  })
})
