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
import { mergeFileContent, mergeEditFields } from '@/model'
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

// ── mergeEditFields ────────────────────────────────────────────

const FIELDS: EditFields = {
  title: 'Essensplan', body: '', tags: [], items: [], participants: [],
  tracked: false, done: false, priority: null, scheduled: null, duration: '', repeat: null,
}

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
