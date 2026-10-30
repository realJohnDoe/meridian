import { useState } from 'react'
import { useStore } from '@/store'
import { useAllParticipants } from '@/hooks'
import { ParticipantsRow, ListedOnRow, defaultParticipants, saveDefaultParticipants, saveDefaultLists, storedDefaultLists } from '@/editor'
import type { VaultRef } from '@/vaultActions'
import type { EntryKey } from '@/fileIO'
import { SettingsSection, SettingsRow } from './SettingsSection'

/** The "New entries" section: the participants and lists a new entry in this vault starts with. */
export function NewEntryDefaultsSection({ vault }: { vault: VaultRef }) {
  const [participants, setParticipants] = useState<string[]>(
    () => defaultParticipants(vault.id),
  )
  const [storedLists, setStoredLists] = useState<EntryKey[]>(
    () => storedDefaultLists(vault.id),
  )
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  // A list deleted since it was picked drops off the row; the stale key leaves
  // storage with the next edit (see `liveDefaultLists`).
  const defaultLists = storedLists.filter(k => roots.has(k))
  const allParticipants = useAllParticipants(items, vault.id)

  function handleParticipantsChange(next: string[]) {
    setParticipants(next)
    saveDefaultParticipants(vault.id, next)
  }

  function handleDefaultListsChange(next: EntryKey[]) {
    setStoredLists(next)
    saveDefaultLists(vault.id, next)
  }

  return (
    <SettingsSection title="New entries" description="Applies to entries created in this vault.">
      <SettingsRow
        label="Default participants"
        description="Added to new entries in this vault automatically. Stored on this device only, so each device (and each person sharing the vault) can set its own."
      >
        <ParticipantsRow
          participants={participants}
          onChange={handleParticipantsChange}
          allParticipants={allParticipants}
        />
      </SettingsRow>
      <SettingsRow
        label="Default lists"
        description="New entries in this vault start out listed on these. Not applied when you turn a checklist item into an entry. Stored on this device only."
      >
        <ListedOnRow
          standalone
          label=""
          className=""
          linkedKeys={defaultLists}
          entryKey={undefined}
          vaultId={vault.id}
          roots={roots}
          onAdd={key => handleDefaultListsChange([...defaultLists, key])}
          onRemove={key => handleDefaultListsChange(defaultLists.filter(k => k !== key))}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
