// @vitest-environment jsdom
/**
 * Covers the three one-way localStorage migrations in `store.ts`: each
 * deletes its own legacy key as it runs, so a wrong second-run path silently
 * discards a user's favourites, participant filter or show-tasks preference
 * with no way back.
 *
 * Every test starts from `vi.resetModules()` + a fresh `import('@/store')`.
 * `migrateParticipantFilter`'s `_filterMigrationChecked` Set lives at module
 * scope and persists across calls to the same store instance — without a
 * fresh module per test, a "populated legacy key" test that runs after some
 * other test already touched the same vaultId would silently no-op (the Set
 * already marks it checked) while still looking like it passed.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'
import { parseToStoreItems } from '@/model'
import { entryKey } from '@/fileIO'
import type { Entries } from '@/types'
import type { useStore as UseStoreHook } from '@/store'

const VAULT = 'migrations-vault'

async function freshStore(): Promise<typeof UseStoreHook> {
  vi.resetModules()
  const mod = await import('@/store')
  return mod.useStore
}

beforeEach(() => {
  localStorage.clear()
})

// ── favorites ────────────────────────────────────────────────────────────

describe('loadFavorites migration', () => {
  it('folds a populated legacy key into the flat list and clears it', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_favorites_${VAULT}`, JSON.stringify(['alpha', 'beta']))

    useStore.getState().loadFavorites([VAULT])

    expect(useStore.getState().favorites).toEqual([
      entryKey(VAULT, 'alpha'),
      entryKey(VAULT, 'beta'),
    ])
    expect(localStorage.getItem(`meridian_favorites_${VAULT}`)).toBeNull()
    expect(JSON.parse(localStorage.getItem('meridian_favorites_all')!)).toEqual([
      entryKey(VAULT, 'alpha'),
      entryKey(VAULT, 'beta'),
    ])
  })

  it('defaults to an empty list and still writes the flat key when no legacy key exists', async () => {
    const useStore = await freshStore()

    useStore.getState().loadFavorites([VAULT])

    expect(useStore.getState().favorites).toEqual([])
    expect(localStorage.getItem('meridian_favorites_all')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('meridian_favorites_all')!)).toEqual([])
  })

  it('clears an empty legacy array without adding anything', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_favorites_${VAULT}`, JSON.stringify([]))

    useStore.getState().loadFavorites([VAULT])

    expect(useStore.getState().favorites).toEqual([])
    expect(localStorage.getItem(`meridian_favorites_${VAULT}`)).toBeNull()
  })

  it('does not re-add or duplicate favourites on a second run after the legacy key was cleared', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_favorites_${VAULT}`, JSON.stringify(['alpha']))

    useStore.getState().loadFavorites([VAULT])
    expect(useStore.getState().favorites).toEqual([entryKey(VAULT, 'alpha')])

    // Legacy key is gone now; a second run must leave the merged list untouched.
    useStore.getState().loadFavorites([VAULT])
    expect(useStore.getState().favorites).toEqual([entryKey(VAULT, 'alpha')])
  })
})

// ── participant filter ──────────────────────────────────────────────────

const YAML_WITH_PARTICIPANTS = (participants: string[]) => `---
title: Standup
date: "2026-05-01"
participants: [${participants.map(p => `"${p}"`).join(', ')}]
---
`

function layerWithParticipants(participants: string[]): Entries {
  const entries: Entries = new Map()
  entries.set(
    entryKey(VAULT, 'standup'),
    parseToStoreItems('standup.md', YAML_WITH_PARTICIPANTS(participants), VAULT),
  )
  return entries
}

describe('migrateParticipantFilter (via setVaultLayer)', () => {
  it('converts a populated legacy inclusive filter into the new hidden set and clears the key', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_participant_filter_${VAULT}`, JSON.stringify(['Alice']))

    useStore.getState().setVaultLayer(VAULT, layerWithParticipants(['Alice', 'Bob']))

    // hidden = allParticipants - oldFilter = { NO_PARTICIPANT, Bob }
    expect(useStore.getState().hiddenParticipants[VAULT]).toEqual(
      expect.arrayContaining(['__no_participant__', 'Bob']),
    )
    expect(useStore.getState().hiddenParticipants[VAULT]).toHaveLength(2)
    expect(useStore.getState().hiddenParticipants[VAULT]).not.toContain('Alice')
    expect(localStorage.getItem(`meridian_participant_filter_${VAULT}`)).toBeNull()
    const stored = JSON.parse(localStorage.getItem('meridian_hidden_participants')!) as Record<string, string[]>
    expect(stored[VAULT]).toEqual(useStore.getState().hiddenParticipants[VAULT])
  })

  it('leaves hiddenParticipants untouched when no legacy key exists', async () => {
    const useStore = await freshStore()

    useStore.getState().setVaultLayer(VAULT, layerWithParticipants(['Alice']))

    expect(useStore.getState().hiddenParticipants[VAULT]).toBeUndefined()
    expect(localStorage.getItem('meridian_hidden_participants')).toBeNull()
  })

  it('clears an empty/non-array legacy value without converting anything', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_participant_filter_${VAULT}`, JSON.stringify([]))

    useStore.getState().setVaultLayer(VAULT, layerWithParticipants(['Alice']))

    expect(useStore.getState().hiddenParticipants[VAULT]).toBeUndefined()
    expect(localStorage.getItem(`meridian_participant_filter_${VAULT}`)).toBeNull()
  })

  it('never re-migrates a vault once checked this session, even if a legacy key reappears', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_participant_filter_${VAULT}`, JSON.stringify(['Alice']))

    useStore.getState().setVaultLayer(VAULT, layerWithParticipants(['Alice', 'Bob']))
    const afterFirstRun = useStore.getState().hiddenParticipants[VAULT]
    expect(afterFirstRun).toBeDefined()

    // Reintroduce a legacy key to prove the guard is the module-level Set,
    // not merely "the key happens to be gone".
    localStorage.setItem(`meridian_participant_filter_${VAULT}`, JSON.stringify(['Bob']))
    useStore.getState().setVaultLayer(VAULT, layerWithParticipants(['Alice', 'Bob', 'Carol']))

    expect(useStore.getState().hiddenParticipants[VAULT]).toEqual(afterFirstRun)
  })
})

// ── show-tasks ───────────────────────────────────────────────────────────

describe('loadShowTasks migration', () => {
  it('adopts a populated legacy per-vault value and clears every vault copy', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_show_tasks_${VAULT}`, JSON.stringify(false))

    useStore.getState().loadShowTasks([VAULT])

    expect(useStore.getState().showTasks).toBe(false)
    expect(localStorage.getItem(`meridian_show_tasks_${VAULT}`)).toBeNull()
    expect(JSON.parse(localStorage.getItem('meridian_show_tasks_all')!)).toBe(false)
  })

  it('defaults to true and writes the global key when no legacy value exists', async () => {
    const useStore = await freshStore()

    useStore.getState().loadShowTasks([VAULT])

    expect(useStore.getState().showTasks).toBe(true)
    expect(JSON.parse(localStorage.getItem('meridian_show_tasks_all')!)).toBe(true)
  })

  it('ignores a malformed (non-boolean) legacy value and falls back to the default', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_show_tasks_${VAULT}`, 'null')

    useStore.getState().loadShowTasks([VAULT])

    expect(useStore.getState().showTasks).toBe(true)
    expect(localStorage.getItem(`meridian_show_tasks_${VAULT}`)).toBeNull()
  })

  it('is a no-op on a second run once the global key is already written', async () => {
    const useStore = await freshStore()
    localStorage.setItem(`meridian_show_tasks_${VAULT}`, JSON.stringify(false))

    useStore.getState().loadShowTasks([VAULT])
    expect(useStore.getState().showTasks).toBe(false)

    // Reintroduce a legacy value that would flip the result if it were read again.
    localStorage.setItem(`meridian_show_tasks_${VAULT}`, JSON.stringify(true))
    useStore.getState().loadShowTasks([VAULT])

    expect(useStore.getState().showTasks).toBe(false)
  })
})
