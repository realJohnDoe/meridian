/**
 * Frontmatter Meridian has no name for must survive a save.
 *
 * The pre-existing round-trip suite asserts a fixed point on Meridian's OWN
 * output (`serialize(parse(serialize(f)))`), never `serialize(parse(f)) ≈ f` —
 * the loss happens on the first pass, so by the time that assertion runs both
 * sides have already been stripped identically. These tests assert against the
 * SOURCE file instead.
 */
import { describe, it, expect } from 'vitest'
import { fixtureNames, loadFixture, parseFixture, serialize, collectKeyValues, frontmatterOf, TEST_VAULT, rootsOf, NEW_TARGET, keyOf, dataOf, serializeKey } from './helpers'
import { parseToStoreItems } from '@/model/storeItems'
import { collapseToYaml } from '@/model/collapse'
import { saveFile } from '@/model/inheritance'
import { applyEdit } from '@/model/storeOps'
import { expandRange } from '@/model/expansion'
import { isSeries, isStandaloneOcc } from '@/types'

const names = fixtureNames()

/** Round-trip a fixture through the exact production write path. */
function roundTrip(name: string): string {
  const p = parseFixture(name)
  return serialize(p.items, p.root)
}

describe('no key loss', () => {
  // The core invariant. Set containment, not equality: collapse legitimately
  // relocates keys between the root and `defaults:` and may duplicate a key
  // across instances — but it must never drop one.
  it.each(names)('%s keeps every frontmatter key/value across a save', (name) => {
    const before = collectKeyValues(frontmatterOf(loadFixture(name)))
    const after = new Set(collectKeyValues(frontmatterOf(roundTrip(name))))
    expect([...new Set(before)].filter(pair => !after.has(pair))).toEqual([])
  })
})

describe('unknown keys at the file root (flat file)', () => {
  // The verbatim repro from the issue.
  it('preserves frontmatter keys the model does not know about', () => {
    const src = [
      '---',
      'title: Quarterly review',
      'project: apollo',
      'url: https://example.com/ticket/42',
      'aliases:',
      '  - QR',
      '---',
      '',
      'Body text here.',
    ].join('\n')
    const p = parseToStoreItems('qr.md', src, TEST_VAULT)
    const out = saveFile(collapseToYaml(p.items, p.root), p.root.body ?? '')
    expect(out).toContain('project: apollo')
    expect(out).toContain('url: https://example.com/ticket/42')
    expect(out).toContain('- QR')
  })

  // The naive fix — stashing the raw frontmatter per FILE and spreading it back
  // over the collapse output — re-emits the schedule twice: once fresh from the
  // model, once stale from the raw node. Guard the specific symptom.
  it('emits date exactly once', () => {
    expect(roundTrip('unknown-keys-flat').match(/^date:/gm)).toHaveLength(1)
  })

  it('keeps scalar types and the markdown body', () => {
    const p = parseFixture('unknown-keys-flat')
    expect(p.items[0].metadata.extra).toEqual({
      project: 'apollo',
      url: 'https://example.com/ticket/42',
      estimate: 3,
      aliases: ['QR', 'Q review'],
    })
    // The root is itself an item here, so the file bag stays empty — otherwise
    // both would emit and the keys would appear twice.
    expect(p.root.extra).toBeUndefined()
    expect(p.root.body).toBe('Body text here.')
  })
})

describe('unknown keys on a series and its instances', () => {
  it('hoists shared unknown keys into defaults: and keeps a divergent one local', () => {
    const out = roundTrip('unknown-keys-series')
    const fm = frontmatterOf(out)
    const defaults = fm.defaults as Record<string, unknown>
    const instances = fm.instances as Record<string, unknown>[]

    expect(defaults.owner).toBe('alice')
    expect(defaults.links).toEqual({ jira: 'ABC-1' })
    // An instance that agrees with the series carries nothing extra…
    expect(instances[0]).toEqual({ date: '2026-04-13', done: true })
    // …and one that diverges carries only the divergence.
    expect(instances[1]).toEqual({ date: '2026-04-20', owner: 'bob' })
  })

  it('the series root owns the defaults: extras, the file root owns none', () => {
    const p = parseFixture('unknown-keys-series')
    const series = p.items.filter(isSeries)
    expect(series[0]!.metadata.extra).toEqual({ owner: 'alice', links: { jira: 'ABC-1' } })
    expect(p.root.extra).toBeUndefined()
  })
})

describe('unknown keys on a container root', () => {
  it('keeps a root-level key at the root, exactly once, and off every instance', () => {
    const out = roundTrip('unknown-keys-container')
    expect(out.match(/^project: apollo$/gm)).toHaveLength(1)

    const fm = frontmatterOf(out)
    expect(fm.project).toBe('apollo')
    for (const inst of fm.instances as Record<string, unknown>[]) {
      expect(inst.project).toBeUndefined()
      expect((inst.defaults as Record<string, unknown> | undefined)?.project).toBeUndefined()
    }
  })

  it('splits ownership: root key on the file, defaults: key on the items', () => {
    const p = parseFixture('unknown-keys-container')
    expect(p.root.extra).toEqual({ project: 'apollo' })
    // `owner` is inherited from the root defaults: block by every item, and
    // overridden on the second series.
    const owners = [...p.items.filter(isSeries), ...p.items.filter(isStandaloneOcc)]
      .map(i => i.metadata.extra?.owner)
    expect(owners).toEqual(['alice', 'bob', 'alice'])
  })
})

describe('nested unknown values', () => {
  it('hoists structurally equal nested values shared across instances', () => {
    const fm = frontmatterOf(roundTrip('unknown-nested'))
    // Both instances parse to distinct objects, so hoisting them requires deep
    // equality — reference equality would leave a copy on each instance.
    expect((fm.defaults as Record<string, unknown>).links)
      .toEqual({ jira: 'ABC-1', docs: ['spec.md'] })
    for (const inst of fm.instances as Record<string, unknown>[]) {
      expect(inst.links).toBeUndefined()
    }
  })

  it('keeps nested values local when they differ', () => {
    const src = [
      '---',
      'title: Design reviews',
      'instances:',
      '  - date: 2026-04-15',
      '    links:',
      '      jira: ABC-1',
      '  - date: 2026-05-20',
      '    links:',
      '      jira: XYZ-9',
      '---',
    ].join('\n')
    const p = parseToStoreItems('dr.md', src, TEST_VAULT)
    const fm = frontmatterOf(saveFile(collapseToYaml(p.items, p.root), ''))
    expect(fm.defaults).toBeUndefined()
    expect((fm.instances as Record<string, unknown>[]).map(i => i.links))
      .toEqual([{ jira: 'ABC-1' }, { jira: 'XYZ-9' }])
  })
})

describe('values the serialiser used to prune', () => {
  it('keeps an explicit null and an empty list', () => {
    const src = '---\ntitle: A\ndate: 2026-04-08\nreviewer: null\naliases: []\n---\n'
    const p = parseToStoreItems('n.md', src, TEST_VAULT)
    const out = saveFile(collapseToYaml(p.items, p.root), '')
    expect(out).toContain('reviewer: null')
    expect(out).toContain('aliases: []')
  })
})

describe('known fields carrying an unexpected type', () => {
  it('keeps the typed field honest while the raw value round-trips', () => {
    const p = parseFixture('malformed-known')
    // The typed fields fall back to their usual absent/empty/filtered value...
    expect(p.items[0].metadata.duration).toBeUndefined()
    expect(p.root.tags).toEqual([])
    // ...including priority and done: a value outside their declared union
    // is exactly as malformed as a wrong container shape (health survey
    // finding #1 — a `Priority` field silently holding `7`, or a `boolean`
    // field holding an arbitrary string, made every downstream `===` check
    // on them a silent no-op instead of a loud failure).
    expect(p.items[0].metadata.priority).toBeUndefined()
    expect(p.items[0].metadata.extra?.priority).toBe(7)
    expect(p.items[0].metadata.done).toBeUndefined()
    expect(p.items[0].metadata.extra?.done).toBe('yes')
    // A stringArray with SOME unrepresentable elements (a nested mapping)
    // keeps its representable elements typed — coerced, not dropped whole —
    // while the untouched raw array survives in extra for the save.
    expect(p.root.items).toEqual(['1', '[[real-note]]'])
    expect(p.root.extra?.items).toEqual([1, { nested: true }, '[[real-note]]'])
    // ...but the raw values for duration/tags survive under their own key.
    expect(p.items[0].metadata.extra?.duration).toEqual([1, 2])
    expect(p.root.extra?.tags).toBe('not-a-list')
  })

  it('emits the raw value exactly once, in place of the typed fallback', () => {
    const out = roundTrip('malformed-known')
    const fm = frontmatterOf(out)
    expect(fm.duration).toEqual([1, 2])
    expect(fm.tags).toBe('not-a-list')
    expect(fm.priority).toBe(7)
    expect(fm.done).toBe('yes')
    expect(fm.items).toEqual([1, { nested: true }, '[[real-note]]'])
    expect(out.match(/^duration:/gm)).toHaveLength(1)
    expect(out.match(/^tags:/gm)).toHaveLength(1)
    expect(out.match(/^items:/gm)).toHaveLength(1)
  })

  it('a retyped value from the editor is not shadowed by the stale raw one', () => {
    // Regression guard for the storeOps registry-key strip (PR2): once a
    // malformed value is parked in extra, an edit that writes a well-shaped
    // value for the same field must not have the stale raw value re-win.
    const p = parseFixture('malformed-known')
    const roots = rootsOf(p.root)
    const occ = expandRange(p.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))[0]!
    const next = applyEdit(dataOf(p.items, roots), occ, 'all', {
      title: 'Malformed fields', tags: ['work'], items: [], participants: [],
      tracked: false, done: false, priority: null,
      scheduled: { date: '2026-04-08', time: '' }, duration: '30m', repeat: null,
      body: '',
    }, NEW_TARGET)
    const yaml = serializeKey(next, keyOf('malformed-known'))
    const fm = frontmatterOf(yaml)
    expect(fm.duration).toBe('30m')
    expect(fm.tags).toEqual(['work'])
  })
})
