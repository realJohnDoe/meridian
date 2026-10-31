/**
 * Three-way merge — both layers.
 *
 * The file-level cases are written against the incident this was built for: two
 * people edit the same note at the same time, one changing only frontmatter and
 * the other only the body, and the CAS write refuses because the byte string as
 * a whole moved. Nothing was lost there and nothing needed a conflict copy;
 * these pin that a merge is attempted, that it keeps *both* changes, and — just
 * as important — that it refuses when the two sides really did overlap.
 */
import { describe, it, expect } from 'vitest'
import { mergeFileContent, mergeEditFields, untouchedRemoteChanges, overlappingFields } from '@/model'
import { loadFile } from '@/fileIO'
import type { EditFields } from '@/model'

const PATH = 'essensplan.md'

/** Read the merged file back through the parser rather than matching bytes —
 *  the assertions are about which values survived, not about YAML formatting. */
function parsed(content: string): { fm: Record<string, unknown>; body: string } {
  const { rawNode, body } = loadFile(PATH, content)
  return { fm: rawNode, body }
}

describe('mergeFileContent — the disjoint case', () => {
  const base = '---\ntitle: Essensplan\n---\n'

  it('combines a frontmatter-only edit with a body-only edit', () => {
    const local  = '---\ntitle: Essensplan\nrepeat: weekly\n---\n'
    const remote = '---\ntitle: Essensplan\n---\n\nNudeln am Dienstag\n'

    const merged = mergeFileContent(PATH, base, local, remote)

    expect(merged).not.toBeNull()
    const { fm, body } = parsed(merged!)
    expect(fm.repeat).toBe('weekly')
    expect(fm.title).toBe('Essensplan')
    expect(body).toBe('Nudeln am Dienstag')
  })

  it('keeps every value the way the user wrote it', () => {
    const base = `---\ntitle: Dentist\nzip: 01234\nphone: +49123456789\ndiscord: 1234567890123456789\nconfirmed: "yes"\nversion: 1.0\n---\n\nBody\n`
    const local = base.replace('title: Dentist', 'title: Dentist (moved)')
    const remote = base.replace('Body', 'Body, plus remote text')
    const merged = mergeFileContent('d.md', base, local, remote)!
    for (const line of ['zip: 01234', 'phone: +49123456789', 'discord: 1234567890123456789', 'confirmed: "yes"', 'version: 1.0']) {
      expect(merged).toContain(line)
    }
  })

  it('is symmetric — the same two edits merge the same way from either side', () => {
    const a = '---\ntitle: Essensplan\nrepeat: weekly\n---\n'
    const b = '---\ntitle: Essensplan\n---\n\nNudeln am Dienstag\n'

    expect(parsed(mergeFileContent(PATH, base, a, b)!))
      .toEqual(parsed(mergeFileContent(PATH, base, b, a)!))
  })

  it('merges two different frontmatter keys', () => {
    const local  = '---\ntitle: Essensplan\npriority: high\n---\n'
    const remote = '---\ntitle: Essensplan\nduration: 30m\n---\n'

    const { fm } = parsed(mergeFileContent(PATH, base, local, remote)!)
    expect(fm.priority).toBe('high')
    expect(fm.duration).toBe('30m')
  })

  it('carries a key one side deleted, when the other side left it alone', () => {
    const withKey = '---\ntitle: Essensplan\npriority: high\n---\n'
    const local   = '---\ntitle: Essensplan\n---\n'                       // deleted priority
    const remote  = '---\ntitle: Essensplan\npriority: high\n---\n\nBody\n' // added a body

    const { fm, body } = parsed(mergeFileContent(PATH, withKey, local, remote)!)
    expect(fm.priority).toBeUndefined()
    expect(body).toBe('Body')
  })

  it('takes the remote when the local side changed nothing', () => {
    const remote = '---\ntitle: Essensplan\n---\n\nRemote body\n'
    expect(parsed(mergeFileContent(PATH, base, base, remote)!).body).toBe('Remote body')
  })

  it('takes the local when the remote changed nothing', () => {
    const local = '---\ntitle: Essensplan\n---\n\nLocal body\n'
    expect(parsed(mergeFileContent(PATH, base, local, base)!).body).toBe('Local body')
  })

  it('accepts both sides making the identical change', () => {
    const same = '---\ntitle: Essensplan\nrepeat: weekly\n---\n'
    expect(parsed(mergeFileContent(PATH, base, same, same)!).fm.repeat).toBe('weekly')
  })

  it('merges structured values by content, not by identity', () => {
    const withTags = '---\ntitle: Essensplan\ntags:\n  - food\n---\n'
    // Same tags, re-serialised inline — must not read as a change on either side.
    const local    = '---\ntitle: Essensplan\ntags: [food]\n---\n\nBody\n'
    const remote   = '---\ntitle: Essensplan\ntags:\n  - food\nrepeat: weekly\n---\n'

    const { fm, body } = parsed(mergeFileContent(PATH, withTags, local, remote)!)
    expect(fm.tags).toEqual(['food'])
    expect(fm.repeat).toBe('weekly')
    expect(body).toBe('Body')
  })
})

describe('mergeFileContent — the overlapping case', () => {
  const base = '---\ntitle: Essensplan\n---\n\nOriginal\n'

  it('refuses when both sides rewrote the body', () => {
    const local  = '---\ntitle: Essensplan\n---\n\nMine\n'
    const remote = '---\ntitle: Essensplan\n---\n\nTheirs\n'
    expect(mergeFileContent(PATH, base, local, remote)).toBeNull()
  })

  it('refuses when both sides set the same frontmatter key differently', () => {
    const local  = '---\ntitle: Essensplan\nrepeat: weekly\n---\n\nOriginal\n'
    const remote = '---\ntitle: Essensplan\nrepeat: daily\n---\n\nOriginal\n'
    expect(mergeFileContent(PATH, base, local, remote)).toBeNull()
  })

  it('refuses when one side deletes a key the other side changes', () => {
    const withKey = '---\ntitle: Essensplan\npriority: high\n---\n\nOriginal\n'
    const local   = '---\ntitle: Essensplan\n---\n\nOriginal\n'
    const remote  = '---\ntitle: Essensplan\npriority: low\n---\n\nOriginal\n'
    expect(mergeFileContent(PATH, withKey, local, remote)).toBeNull()
  })

  it('refuses on an overlapping body even when the frontmatter merges cleanly', () => {
    const local  = '---\ntitle: Essensplan\nrepeat: weekly\n---\n\nMine\n'
    const remote = '---\ntitle: Essensplan\npriority: high\n---\n\nTheirs\n'
    expect(mergeFileContent(PATH, base, local, remote)).toBeNull()
  })
})

describe('mergeFileContent — items checklists merge line by line', () => {
  const list = (...lines: string[]) =>
    `---\ntitle: Einkauf\nitems:\n${lines.map(l => `  - "${l}"`).join('\n')}\n---\n`
  const items = (content: string | null) => parsed(content!).fm.items
  const base = list('[ ] Milch', '[ ] Brot', '[ ] Eier')

  it('keeps a line one side added and a box the other side ticked', () => {
    const local  = list('[ ] Milch', '[ ] Brot', '[ ] Eier', '[ ] Käse')
    const remote = list('[ ] Milch', '[x] Brot', '[ ] Eier')
    expect(items(mergeFileContent(PATH, base, local, remote)))
      .toEqual(['[ ] Milch', '[x] Brot', '[ ] Eier', '[ ] Käse'])
  })

  it('puts an added line after the line it followed on its own side', () => {
    const local  = list('[ ] Milch', '[ ] Butter', '[ ] Brot', '[ ] Eier')
    const remote = list('[ ] Milch', '[ ] Eier')                           // removed Brot
    expect(items(mergeFileContent(PATH, base, local, remote)))
      .toEqual(['[ ] Milch', '[ ] Butter', '[ ] Eier'])
  })

  it('follows the order of the side that reordered', () => {
    const local  = list('[ ] Eier', '[ ] Milch', '[ ] Brot')
    const remote = list('[ ] Milch', '[x] Brot', '[ ] Eier')
    expect(items(mergeFileContent(PATH, base, local, remote)))
      .toEqual(['[ ] Eier', '[ ] Milch', '[x] Brot'])
  })

  it('accepts both sides ticking the same box', () => {
    const ticked = list('[ ] Milch', '[x] Brot', '[ ] Eier')
    expect(items(mergeFileContent(PATH, base, ticked, list('[x] Milch', '[x] Brot', '[ ] Eier'))))
      .toEqual(['[x] Milch', '[x] Brot', '[ ] Eier'])
  })

  it('refuses when both sides changed the same line differently', () => {
    const local  = list('[ ] Milch', '[x] Brot', '[ ] Eier')
    const remote = list('[ ] Milch', '[ ] Vollkornbrot', '[ ] Eier')       // renamed = removed Brot
    expect(mergeFileContent(PATH, base, local, remote)).toBeNull()
  })

  it('refuses when both sides reordered', () => {
    const local  = list('[ ] Eier', '[ ] Milch', '[ ] Brot')
    const remote = list('[ ] Brot', '[ ] Milch', '[ ] Eier')
    expect(mergeFileContent(PATH, base, local, remote)).toBeNull()
  })

  it('refuses when a side holds the same line twice — there is nothing to match on', () => {
    const local  = list('[ ] Milch', '[ ] Brot', '[ ] Eier', '[ ] Milch')
    const remote = list('[ ] Milch', '[x] Brot', '[ ] Eier')
    expect(mergeFileContent(PATH, base, local, remote)).toBeNull()
  })
})

// ── mergeEditFields ────────────────────────────────────────────

const FIELDS: EditFields = {
  title: 'Essensplan', body: '', tags: [], items: [], participants: [],
  tracked: false, done: false, priority: null, scheduled: null, duration: '', repeat: null,
}

describe('mergeFileContent — series instances merge by date', () => {
  const head = '---\ntitle: Run\ndate: 2026-04-06\nrepeat:\n  type: schedule\n  freq: daily\n'
  const file = (...dates: string[]) =>
    head + (dates.length ? 'instances:\n' + dates.map(d => `  - date: ${d}\n    done: true\n`).join('') : '') + '---\n'
  const dates = (s: string | null) =>
    (loadFile('r.md', s ?? '').rawNode.instances as Array<{ date: string }>).map(i => i.date)

  it('keeps ticks made on different occurrences', () => {
    const merged = mergeFileContent('r.md', file(), file('2026-04-06'), file('2026-04-07'))
    expect(merged).not.toBeNull()
    expect(dates(merged)).toEqual(['2026-04-06', '2026-04-07'])
  })

  it('drops an override one side removed and the other left alone', () => {
    const merged = mergeFileContent('r.md', file('2026-04-06', '2026-04-07'), file('2026-04-06'), file('2026-04-06', '2026-04-07'))
    expect(dates(merged)).toEqual(['2026-04-06'])
  })

  it('copies out when the series shape changed on either side', () => {
    const split = file('2026-04-06').replace('freq: daily', 'freq: daily\n  end: 2026-04-08')
    expect(mergeFileContent('r.md', file(), split, file('2026-04-10'))).toBeNull()
  })

  it('copies out when both sides edited the same override differently', () => {
    const edit = (v: string) => file('2026-04-06').replace('done: true', v)
    expect(mergeFileContent('r.md', file('2026-04-06'), edit('done: true\n    note: x'), edit('done: false'))).not.toBeNull()
    expect(mergeFileContent('r.md', file('2026-04-06'), edit('done: false'), edit('done: 1'))).toBeNull()
  })
})

describe('mergeEditFields', () => {
  it('writes a touched field and leaves an untouched one at the store value', () => {
    const base    = FIELDS
    const next    = { ...FIELDS, repeat: { type: 'interval', unit: 'week', every: 1 } as unknown as EditFields['repeat'] }
    const current = { ...FIELDS, body: 'a description someone else wrote' }

    const merged = mergeEditFields(base, next, current)

    expect(merged.repeat).toEqual(next.repeat)
    expect(merged.body).toBe('a description someone else wrote')
  })

  it('does not resurrect a field the editor never touched — the incident case', () => {
    // The editor loaded before the description existed and is only changing the
    // title. A blind write would send its own empty body and delete the
    // description; on a synced vault that deletion is a push.
    const base    = FIELDS
    const next    = { ...FIELDS, title: 'Essensplan (neu)' }
    const current = { ...FIELDS, body: 'Nudeln am Dienstag' }

    expect(mergeEditFields(base, next, current).body).toBe('Nudeln am Dienstag')
  })

  it('lets the editor clear a field it did touch', () => {
    const base    = { ...FIELDS, body: 'old text' }
    const next    = { ...FIELDS, body: '' }
    const current = { ...FIELDS, body: 'old text' }

    expect(mergeEditFields(base, next, current).body).toBe('')
  })

  it('the editor wins a field both sides changed', () => {
    const base    = FIELDS
    const next    = { ...FIELDS, priority: 'high' as const }
    const current = { ...FIELDS, priority: 'low' as const }

    expect(mergeEditFields(base, next, current).priority).toBe('high')
  })

  it('compares arrays by content, so a re-created array is not a change', () => {
    const base    = { ...FIELDS, tags: ['food'] }
    const next    = { ...FIELDS, tags: ['food'] }             // same tags, new array
    const current = { ...FIELDS, tags: ['food', 'weekly'] }   // a tag added elsewhere

    expect(mergeEditFields(base, next, current).tags).toEqual(['food', 'weekly'])
  })

  it('compares nested objects by content', () => {
    const base    = { ...FIELDS, scheduled: { date: '2026-08-24', time: '18:00' } }
    const next    = { ...FIELDS, scheduled: { date: '2026-08-24', time: '18:00' }, title: 'Renamed' }
    const current = { ...FIELDS, scheduled: { date: '2026-08-30', time: '18:00' } }

    const merged = mergeEditFields(base, next, current)
    expect(merged.scheduled).toEqual({ date: '2026-08-30', time: '18:00' })
    expect(merged.title).toBe('Renamed')
  })
})

// ── untouchedRemoteChanges / overlappingFields ─────────────────
//
// The same verdict `mergeEditFields` acts on, named so an open editor can act
// on it too: adopt what only the store moved, and say so when both sides moved
// the same field. See useLiveReload.

describe('untouchedRemoteChanges', () => {
  it('reports a field only the store moved', () => {
    const base   = FIELDS
    const local  = FIELDS
    const remote = { ...FIELDS, priority: 'high' as const }

    expect(untouchedRemoteChanges(base, local, remote)).toEqual({ priority: 'high' })
  })

  it('says nothing about a field the editor touched, whatever the store did', () => {
    const base   = FIELDS
    const local  = { ...FIELDS, title: 'Mine' }
    const remote = { ...FIELDS, title: 'Theirs' }

    expect(untouchedRemoteChanges(base, local, remote)).toEqual({})
  })

  it('says nothing when neither side moved', () => {
    expect(untouchedRemoteChanges(FIELDS, { ...FIELDS }, { ...FIELDS })).toEqual({})
  })

  it('reports a value the store cleared, not just one it set', () => {
    const base   = { ...FIELDS, duration: '30m' }
    const remote = { ...FIELDS, duration: '' }

    expect(untouchedRemoteChanges(base, { ...base }, remote)).toEqual({ duration: '' })
  })

  it('compares by content, so a re-created array is not something to adopt', () => {
    const base   = { ...FIELDS, tags: ['food'] }
    const local  = { ...FIELDS, tags: ['food'] }
    const remote = { ...FIELDS, tags: ['food'] }

    expect(untouchedRemoteChanges(base, local, remote)).toEqual({})
  })
})

describe('overlappingFields', () => {
  it('names a field both sides moved to different values', () => {
    const base   = FIELDS
    const local  = { ...FIELDS, title: 'Mine', body: 'Mine too' }
    const remote = { ...FIELDS, title: 'Theirs', body: 'Theirs too' }

    expect(overlappingFields(base, local, remote)).toEqual(['title', 'body'])
  })

  it('is not a conflict when both sides made the same change', () => {
    const base   = FIELDS
    const local  = { ...FIELDS, done: true }
    const remote = { ...FIELDS, done: true }

    expect(overlappingFields(base, local, remote)).toEqual([])
  })

  it('is not a conflict when only one side moved', () => {
    const base   = FIELDS
    expect(overlappingFields(base, { ...FIELDS, done: true }, { ...FIELDS })).toEqual([])
    expect(overlappingFields(base, { ...FIELDS }, { ...FIELDS, done: true })).toEqual([])
  })
})
