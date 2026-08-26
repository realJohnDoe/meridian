import { describe, it, expect } from 'vitest'
import { settingsTopbar } from './-settingsTopbar'

const names: Record<string, string> = { 'gh-vault': 'Work' }
const vaultName = (id: string) => names[id]

describe('settingsTopbar', () => {
  it('returns null outside settings', () => {
    expect(settingsTopbar('/', vaultName)).toBeNull()
    expect(settingsTopbar('/backlog', vaultName)).toBeNull()
    expect(settingsTopbar('/day/2026-08-26', vaultName)).toBeNull()
  })

  it('does not mistake a path that merely starts with the word for a settings screen', () => {
    expect(settingsTopbar('/settingsfoo', vaultName)).toBeNull()
  })

  it('has no back target at the settings root', () => {
    expect(settingsTopbar('/settings', vaultName)).toEqual({ title: 'Settings', backTo: null })
  })

  it('tolerates a trailing slash on the root', () => {
    expect(settingsTopbar('/settings/', vaultName)).toEqual({ title: 'Settings', backTo: null })
  })

  it('titles the appearance screen and sends back to the root', () => {
    expect(settingsTopbar('/settings/appearance', vaultName)).toEqual({ title: 'Appearance', backTo: '/settings' })
  })

  it('titles the add-vault screen', () => {
    expect(settingsTopbar('/settings/vault/new', vaultName)).toEqual({ title: 'Add vault', backTo: '/settings' })
  })

  it('titles a vault screen with the vault name', () => {
    expect(settingsTopbar('/settings/vault/gh-vault', vaultName)).toEqual({ title: 'Work', backTo: '/settings' })
  })

  it('falls back to a generic title while the vault is not loaded yet', () => {
    expect(settingsTopbar('/settings/vault/unknown', vaultName)).toEqual({ title: 'Vault', backTo: '/settings' })
  })

  it('keeps an unrecognised settings sub-path navigable', () => {
    expect(settingsTopbar('/settings/whatever', vaultName)).toEqual({ title: 'Settings', backTo: '/settings' })
  })
})
