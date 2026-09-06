/**
 * A value the user wrote must come back as the characters they wrote.
 *
 * Meridian rebuilds every file from the store on each save, so before this was
 * fixed each value was re-derived from the JavaScript primitive it parsed to —
 * and a primitive has no memory of its spelling. Three of the shapes below were
 * *unrecoverable* corruption (an ID past 2⁵³, a leading `+`, a leading zero):
 * the original digits are not present anywhere in the saved file, so no later
 * fix can restore them. Data-integrity survey, finding #6.
 *
 * `unknown-keys.test.ts` covers which keys survive; this covers what they
 * survive AS.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { serializeEntry } from '@/model'
import { roundTripLoss } from '@/model/roundTripCheck'
import { isRawScalar } from '@/fileIO'
import { TEST_VAULT } from './helpers'

/** One unedited save of a single-key file, through the production write path. */
function save(line: string): string {
  const content = `---\ntitle: T\n${line}\n---\n`
  const p = parseToStoreItems('n.md', content, TEST_VAULT)
  return serializeEntry(p.items, p.root)
}

describe('unknown keys keep the characters they were written with', () => {
  // The finding's repro table, verbatim. The first three were value
  // corruption; the rest changed what other tools read the file as.
  it.each([
    ['a snowflake id past 2⁵³', 'discord: 1234567890123456789'],
    ['an E.164 number',         'phone: +49123456789'],
    ['a zip code',              'zip: 01234'],
    ['a trailing-zero decimal', 'version: 1.0'],
    ['exponent notation',       'n: 1e3'],
    ['hexadecimal',             'n: 0x1F'],
    ['octal',                   'n: 0o17'],
    ['a quoted yes',            'x: "yes"'],
    ['a single-quoted string',  "x: 'single'"],
    ['an explicit tilde null',  'x: ~'],
    ['a bare empty value',      'x:'],
  ])('%s survives an unedited save', (_name, line) => {
    expect(save(line)).toContain(line)
  })

  // `x: "yes"` is the interop row and the reason style is preserved as well as
  // source: YAML 1.1 readers (PyYAML, Ruby, js-yaml's default schema,
  // Obsidian) read the unquoted form as boolean `true`, so dropping the quotes
  // silently changes the value for every reader but this one.
  it('does not let a quoted yes escape as a bare yes', () => {
    expect(save('x: "yes"')).not.toMatch(/^x: yes$/m)
  })

  it('preserves a quoted element inside an unknown sequence', () => {
    expect(save('aliases:\n  - "01"\n  - plain')).toContain('- "01"')
  })

  it('preserves a value nested under an unknown mapping', () => {
    expect(save('meta:\n  ref: 007')).toContain('ref: 007')
  })

  it('reports nothing lost, where it used to report the key as clean while corrupting it', () => {
    const content = '---\ntitle: T\ndiscord: 1234567890123456789\nzip: 01234\n---\n'
    const parsed = parseToStoreItems('n.md', content, TEST_VAULT)
    expect(roundTripLoss('n.md', content, parsed)).toEqual([])
  })
})

describe('typed fields keep their authored form while they are untouched', () => {
  it('a hand-quoted title stays quoted', () => {
    const content = '---\ntitle: "yes"\ndate: 2026-04-08\n---\n'
    const p = parseToStoreItems('n.md', content, TEST_VAULT)
    expect(serializeEntry(p.items, p.root)).toContain('title: "yes"')
  })

  it('an occurrence-level field keeps its authored form too', () => {
    const content = '---\ntitle: T\ndate: 2026-04-08\nduration: "90"\n---\n'
    const p = parseToStoreItems('n.md', content, TEST_VAULT)
    expect(serializeEntry(p.items, p.root)).toContain('duration: "90"')
  })

  // The rule that makes `sources` a formatting record rather than a second copy
  // of the data: it may only speak while it still agrees with the typed value.
  // Nothing clears it on edit — it simply stops matching, and is ignored.
  it('a retyped value drops the authored form instead of resurrecting it', () => {
    const content = '---\ntitle: "yes"\ndate: 2026-04-08\n---\n'
    const p = parseToStoreItems('n.md', content, TEST_VAULT)
    const renamed = { ...p.root, title: 'no' }
    const out = serializeEntry(p.items, renamed)
    expect(out).toContain('title: no')
    expect(out).not.toContain('yes')
  })

  // Meridian normalises what it computes. `date`/`time`/`repeat`/`excluded` are
  // the schedule — an edit moves them — so they stay normalised, which is what
  // `roundTripCheck.ts`'s NORMALISED_KEYS already promises about them.
  it('leaves the structural keys normalised', () => {
    const content = '---\ntitle: T\ndate: "2026-04-08"\n---\n'
    const p = parseToStoreItems('n.md', content, TEST_VAULT)
    expect(serializeEntry(p.items, p.root)).toContain('date: 2026-04-08')
  })
})

describe('a scalar is only boxed when the plain value would lose something', () => {
  // `fileIO.ts`'s `survivesPlainEmission` decides which scalars keep their
  // source, and it decides it by reasoning about the emitter rather than by
  // asking it — so this sweep asks. Every shape must come back as itself: a
  // shape the predicate wrongly calls safe is one that gets silently
  // reformatted with nothing left to restore it, which is the whole bug.
  const SHAPES = [
    'alice', 'Quarterly review', 'https://example.com/t/42?a=b&c=d', 'ABC-1',
    'true', 'false', 'null', '~', '42', '-7', '0', '3.5', 'yes', 'no', 'on', 'off',
    '01234', '+49123456789', '1234567890123456789', '1.0', '1e3', '0x1F', '0o17',
    '"yes"', "'single'", '"a\\tb"', '"01"', 'a b c', "it's fine", '2026-04-08',
    '.nan', '.inf', 'Null', 'TRUE', 'ends with spaces',
  ]

  it.each(SHAPES)('round-trips %j', (shape) => {
    const out = save(`k: ${shape}`)
    expect(/^k:(.*)$/m.exec(out)?.[1]?.trim() ?? '').toBe(shape)
  })

  it('keeps a bare empty value bare rather than writing null into it', () => {
    expect(save('k:')).toMatch(/^k:\s*$/m)
  })

  it('leaves an ordinary string unboxed, so nothing downstream sees a wrapper', () => {
    const p = parseToStoreItems('n.md', '---\ntitle: T\nowner: alice\nurl: https://x.test/1\n---\n', TEST_VAULT)
    expect(p.items[0].metadata.extra).toEqual({ owner: 'alice', url: 'https://x.test/1' })
  })

  it('boxes only the value that needs it', () => {
    const p = parseToStoreItems('n.md', '---\ntitle: T\nowner: alice\nzip: 01234\n---\n', TEST_VAULT)
    const extra = p.items[0].metadata.extra ?? {}
    expect(isRawScalar(extra.owner)).toBe(false)
    expect(isRawScalar(extra.zip)).toBe(true)
  })
})

describe('hoisting carries the authored form with the value', () => {
  // `computeSharedFields` emits a shared field once, from the root `defaults:`
  // block — so a spelling left behind on the items is a spelling lost, on a
  // field nobody edited.
  it('hoists the source when every item agrees on it', () => {
    const content = [
      '---', 'title: T', 'instances:',
      '  - date: 2026-04-08', '    timezone: "Europe/Berlin"',
      '  - date: 2026-04-09', '    timezone: "Europe/Berlin"',
      '---', '',
    ].join('\n')
    const p = parseToStoreItems('n.md', content, TEST_VAULT)
    const out = serializeEntry(p.items, p.root)
    expect(out).toContain('timezone: "Europe/Berlin"')
    // Once, in `defaults:` — the hoist still happened; it just kept the quotes.
    expect(out.match(/timezone:/g)).toHaveLength(1)
    expect(out).toMatch(/defaults:\n\s+timezone:/)
  })

  // The other half of the rule: the values match, so the field still hoists —
  // but neither spelling can claim to be the shared one, so the hoisted copy
  // falls back to Meridian's own formatting rather than picking a winner.
  it('drops the source when two items spell the same value differently', () => {
    const content = [
      '---', 'title: T', 'instances:',
      '  - date: 2026-04-08', '    timezone: "Europe/Berlin"',
      '  - date: 2026-04-09', '    timezone: Europe/Berlin',
      '---', '',
    ].join('\n')
    const p = parseToStoreItems('n.md', content, TEST_VAULT)
    const out = serializeEntry(p.items, p.root)
    expect(out).toContain('timezone: Europe/Berlin')
    expect(out.match(/timezone:/g)).toHaveLength(1)
  })
})

describe('anchors and aliases', () => {
  // A documented non-goal (model/AGENTS.md): an alias is resolved to a copy
  // rather than preserved. What matters is that it resolves at all — an
  // unknown key's subtree is walked node by node, and an `Alias` is the one
  // node kind there that has no value of its own to read. Getting that wrong
  // throws or yields `null`, silently emptying the key.
  it('resolves an alias to a copy instead of dropping the key', () => {
    const content = '---\ntitle: T\nbase: &a hello\necho: *a\n---\n'
    const p = parseToStoreItems('n.md', content, TEST_VAULT)
    expect(p.items[0].metadata.extra).toEqual({ base: 'hello', echo: 'hello' })
    expect(serializeEntry(p.items, p.root)).toContain('echo: hello')
  })

  it('resolves an aliased mapping, and writes no anchor of its own', () => {
    const content = '---\ntitle: T\nbase: &a {k: v}\necho: *a\n---\n'
    const p = parseToStoreItems('n.md', content, TEST_VAULT)
    const out = serializeEntry(p.items, p.root)
    expect(out).not.toMatch(/[&*]a\b/)
    expect(out.match(/k: v/g)).toHaveLength(2)
  })
})
