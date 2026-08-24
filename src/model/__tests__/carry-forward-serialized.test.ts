/**
 * `editedEntry` (model/storeOps.ts) carries two things forward on every edit
 * scope without the editor ever seeing them: the file's unknown frontmatter
 * keys (`extra`) and its line-ending convention (`fileConvention`). Both are
 * optional fields, so an edit that rebuilds FileMetadata field-by-field and
 * forgets either one still type-checks and passes any assertion made against
 * the in-memory store — the loss only shows up in the bytes actually written
 * to disk, weeks later, as a mystery git diff.
 *
 * These assertions therefore run against `serialize`'s output, not the store,
 * and across all four edit scopes editedEntry is reachable from.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { applyEdit } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { expandRange } from '@/model/expansion'
import type { EditScope, Occurrence, Roots, StoreItem } from '@/types'
import { loadFixture, rootsOf, TEST_VAULT, NEW_TARGET, itemsOf, rootsIn, dataOf, serializeOnly } from './helpers'

/**
 * `unknown-keys-container.md` re-parsed with every newline forced to `\r\n`,
 * so `fileConvention.crlf` is detected true from the file's own bytes — same
 * as a real CRLF file loaded from disk. Its root carries `project: apollo`,
 * an unknown key `editedEntry` never mints and must not drop.
 */
function crlfFixtureData(): StoreData {
  const crlfSource = loadFixture('unknown-keys-container').replace(/\n/g, '\r\n')
  const { items, root } = parseToStoreItems('unknown-keys-container.md', crlfSource, TEST_VAULT)
  return dataOf(items, rootsOf(root))
}

function occOn(items: StoreItem[], roots: Roots, dateISO: string): Occurrence {
  const occs = expandRange(items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
  const occ = occs.find(o => o.date === dateISO)
  if (!occ) throw new Error(`no occurrence on ${dateISO}`)
  return occ
}

function editFields(occ: Occurrence, over: Partial<EditFields> = {}): EditFields {
  const m = occ.metadata
  return {
    title: m.title, tags: m.tags, items: m.items,
    participants: m.participants, body: m.body ?? '',
    tracked: m.done !== undefined, done: m.done ?? false,
    priority: m.priority ?? null,
    scheduled: occ.date ? { date: occ.date, time: occ.time ?? '' } : null,
    duration: m.duration ?? '', repeat: null,
    ...over,
  }
}

function serializeData(data: StoreData): string {
  return serializeOnly(data)
}

const ANCHOR = '2026-04-06'
const DIVERGING = '2026-04-20'
const GENERATED = '2026-04-27'

const SCOPES: Record<EditScope, (data: StoreData) => StoreData> = {
  all: d => applyEdit(d, occOn(itemsOf(d), rootsIn(d), ANCHOR), 'all',
    editFields(occOn(itemsOf(d), rootsIn(d), ANCHOR), { duration: '45m' }), NEW_TARGET),
  single: d => applyEdit(d, occOn(itemsOf(d), rootsIn(d), DIVERGING), 'single',
    editFields(occOn(itemsOf(d), rootsIn(d), DIVERGING), { priority: 'high' }), NEW_TARGET),
  future: d => applyEdit(d, occOn(itemsOf(d), rootsIn(d), GENERATED), 'future',
    editFields(occOn(itemsOf(d), rootsIn(d), GENERATED), { duration: '15m' }), NEW_TARGET),
  add: d => applyEdit(d, occOn(itemsOf(d), rootsIn(d), ANCHOR), 'add',
    editFields(occOn(itemsOf(d), rootsIn(d), ANCHOR), { scheduled: { date: '2026-08-03', time: '' } }), NEW_TARGET),
}

describe('extra and fileConvention carry forward across every edit scope, on the saved bytes', () => {
  it('the fixture is genuinely CRLF before any edit runs', () => {
    const data = crlfFixtureData()
    const root = [...rootsIn(data).values()][0]
    expect(root?.fileConvention?.crlf).toBe(true)
    expect(root?.extra?.project).toBe('apollo')
  })

  it.each(Object.keys(SCOPES) as EditScope[])(
    'scope "%s" keeps the root\'s unknown key and CRLF convention in the serialized file',
    (scope) => {
      const before = crlfFixtureData()
      const after = SCOPES[scope](before)
      const out = serializeData(after)

      expect(out).toContain('project: apollo')
      expect(out).toMatch(/^---\r\n/)
      // The whole file (this fixture has no body) must use \r\n exclusively —
      // a bare \n anywhere means some structural glue reverted to LF.
      expect(out).not.toMatch(/(?<!\r)\n/)
    },
  )
})
