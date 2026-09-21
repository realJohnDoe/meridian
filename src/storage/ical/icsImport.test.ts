/**
 * The two properties that make an import a move-in rather than a copy: the
 * files are named the way the user's own entries are named, and running the
 * same import twice leaves the vault the size it was after the first.
 *
 * Both are pinned against the real pipeline — `icsToEntries` →
 * `parseToStoreItems` → store — rather than a stub of it, because what they
 * really assert is that a re-slugged file still behaves like the converter's
 * own golden tests say a synthesized file does (`icsToEntries.test.ts`).
 */
import { describe, it, expect } from 'vitest'
import { setupStore, TEST_VAULT } from '@/test-utils'
import { useStore } from '@/store'
import { entryKey, keySlug, titleToSlug, pathToKey } from '@/fileIO'
import { parseToStoreItems, roundTripLoss } from '@/model'
import { icsToEntries } from './icsToEntries'
import { planIcsImport, planEntryImport, vaultImportCandidates } from './icsImport'

setupStore()

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`
const event = (lines: string[]) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`
const calendar = (...events: string[]) => wrap(events.join('\r\n'))

const LUNCH   = event(['UID:lunch@example',   'DTSTART:20260817T090000', 'SUMMARY:Lunch with Sam'])
const STANDUP = event(['UID:standup@example', 'DTSTART:20260818T090000', 'SUMMARY:Team Standup'])

/** Plan an import and commit it to the store, the way `importVaultIcs` does. */
function importInto(ics: string): { added: number; updated: number; slugs: string[] } {
  const plan = planIcsImport(TEST_VAULT, ics)
  if (!plan) throw new Error('not a calendar')
  useStore.getState().setData(plan.next.entries)
  return { added: plan.added, updated: plan.updated, slugs: plan.keys.map(keySlug) }
}

describe('planIcsImport', () => {
  it('is null when the text is not a calendar', () => {
    expect(planIcsImport(TEST_VAULT, '<html>Please sign in</html>')).toBeNull()
  })

  it('names the files after the event titles, not after the UID hash', () => {
    const { slugs, added } = importInto(calendar(LUNCH, STANDUP))

    expect(slugs).toEqual(['lunch-with-sam', 'team-standup'])
    expect(added).toBe(2)
  })

  it('updates in place on re-import instead of duplicating', () => {
    importInto(calendar(LUNCH, STANDUP))
    const second = importInto(calendar(LUNCH, STANDUP))

    expect(second).toMatchObject({ added: 0, updated: 2 })
    expect(second.slugs).toEqual(['lunch-with-sam', 'team-standup'])
    expect(useStore.getState().entries.size).toBe(2)
  })

  it('carries a changed SUMMARY onto the entry the first import made, keeping its filename', () => {
    importInto(calendar(LUNCH))
    const renamed = event(['UID:lunch@example', 'DTSTART:20260817T090000', 'SUMMARY:Lunch with Sam and Ada'])

    const { updated, slugs } = importInto(calendar(renamed))

    expect(updated).toBe(1)
    // The slug is the entry's identity once it is the user's — its URL and its
    // wikilink target — so a retitled event updates the file it already has
    // rather than moving to a new one and orphaning every link to the old.
    expect(slugs).toEqual(['lunch-with-sam'])
    expect(useStore.getState().entries.get(entryKey(TEST_VAULT, 'lunch-with-sam'))?.root.title)
      .toBe('Lunch with Sam and Ada')
  })

  it('gives two events sharing a title distinct filenames', () => {
    const { slugs } = importInto(calendar(
      event(['UID:a@example', 'DTSTART:20260817T090000', 'SUMMARY:Review']),
      event(['UID:b@example', 'DTSTART:20260818T090000', 'SUMMARY:Review']),
    ))

    expect(slugs).toEqual(['review', 'review-2'])
  })

  it('steps around a slug an unrelated entry already holds', () => {
    importInto(calendar(event(['UID:mine@example', 'DTSTART:20260817T090000', 'SUMMARY:Lunch with Sam'])))
    const { slugs } = importInto(calendar(LUNCH))

    expect(slugs).toEqual(['lunch-with-sam-2'])
  })

  it('changes nothing until the caller commits', () => {
    planIcsImport(TEST_VAULT, calendar(LUNCH, STANDUP))

    expect(useStore.getState().entries.size).toBe(0)
  })
})

describe('planIcsImport — round trip', () => {
  it('leaves the converter output lossless at the filename the import gives it', () => {
    const synthesis = icsToEntries(calendar(
      event([
        'UID:weekly@example', 'DTSTART:20260817T090000', 'DTEND:20260817T093000',
        'SUMMARY:Team Standup', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'LOCATION:Room 2',
        'ATTENDEE;CN=Alice Adams:mailto:alice@example.com',
      ]),
      LUNCH,
    ))!

    for (const entry of synthesis.entries) {
      // The import's own slug, not the converter's `ical-<hash>` one — the
      // property has to hold at the name the file actually lands under.
      const path = `${titleToSlug(entry.title)}.md`
      expect(roundTripLoss(path, entry.content, parseToStoreItems(path, entry.content, TEST_VAULT))).toEqual([])
    }
  })
})

// ── Moving a subscription in ────────────────────────────────────────────────
//
// The other front door onto the same planner: the events are already in the
// store as an iCal vault's layer, so a conversion re-reads them from there
// rather than re-fetching the feed. What these pin is that arriving that way
// reaches the same place as arriving from a file — same filenames, same UID
// dedupe — because that convergence is the reason the planner takes candidates
// rather than a document.

const FEED = 'feed-vault'

/** Mount a vault's worth of synthesized entries the way `parseFiles` does. */
function seedFeed(ics: string): void {
  const synthesis = icsToEntries(ics)!
  const layer = new Map(synthesis.entries.map(e => {
    const path = `${e.fileSlug}.md`
    return [pathToKey(FEED, path), parseToStoreItems(path, e.content, FEED)] as const
  }))
  useStore.getState().setVaultLayer(FEED, layer)
}

describe('vaultImportCandidates', () => {
  it('offers every event the subscription is showing, by title and uid', () => {
    seedFeed(calendar(LUNCH, STANDUP))

    expect(vaultImportCandidates(FEED).map(c => ({ title: c.title, uid: c.uid }))).toEqual([
      { title: 'Lunch with Sam', uid: 'lunch@example' },
      { title: 'Team Standup', uid: 'standup@example' },
    ])
  })

  it('skips an entry with no uid — there is no identity to dedupe a second run on', () => {
    useStore.getState().setVaultLayer(FEED, new Map([
      [pathToKey(FEED, 'hand-written.md'), parseToStoreItems('hand-written.md', '---\ntitle: Hand written\ndate: 2026-08-17\n---\n', FEED)],
    ]))

    expect(vaultImportCandidates(FEED)).toEqual([])
  })

  it('lands on the same filenames a file import would, and only once', () => {
    seedFeed(calendar(LUNCH, STANDUP))

    const plan = planEntryImport(TEST_VAULT, vaultImportCandidates(FEED))
    expect(plan.keys.map(keySlug)).toEqual(['lunch-with-sam', 'team-standup'])
    expect(plan.added).toBe(2)

    // The feed's own `ical-<hash>` files are untouched: a conversion copies out
    // of the subscription, it does not move the subscription's own entries.
    useStore.getState().setData(plan.next.entries)
    expect(useStore.getState().entries.get(entryKey(TEST_VAULT, 'lunch-with-sam'))).toBeDefined()
    expect(vaultImportCandidates(FEED)).toHaveLength(2)
  })

  it('updates in place when the same calendar was already imported from a file', () => {
    importInto(calendar(LUNCH, STANDUP))
    seedFeed(calendar(LUNCH, STANDUP))

    const plan = planEntryImport(TEST_VAULT, vaultImportCandidates(FEED))

    // Same events, same UIDs — so moving the subscription in converges on the
    // entries the file import already made rather than doubling them.
    expect(plan).toMatchObject({ added: 0, updated: 2 })
    expect(plan.keys.map(keySlug)).toEqual(['lunch-with-sam', 'team-standup'])
  })
})
