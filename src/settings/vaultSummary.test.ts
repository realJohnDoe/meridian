import { describe, it, expect } from 'vitest'
import type { VaultRef } from '@/vaultRef'
import { vaultSummary, attentionLabel } from './vaultSummary'

describe('vaultSummary', () => {
  it('names owner, repo and branch for a GitHub vault', () => {
    const vault: VaultRef = {
      id: 'gh', name: 'Work', kind: 'github',
      github: { owner: 'acme', repo: 'notes', branch: 'main' },
    }
    expect(vaultSummary(vault)).toBe('acme/notes · main')
  })

  it('distinguishes two GitHub vaults that share a display name', () => {
    const a: VaultRef = { id: 'a', name: 'Notes', kind: 'github', github: { owner: 'acme', repo: 'notes', branch: 'main' } }
    const b: VaultRef = { id: 'b', name: 'Notes', kind: 'github', github: { owner: 'me', repo: 'notes', branch: 'main' } }
    expect(vaultSummary(a)).not.toBe(vaultSummary(b))
  })

  it('marks a subscription as read-only', () => {
    const vault: VaultRef = { id: 'ical', name: 'Team', kind: 'ical', ical: { url: 'https://example.com/x.ics' } }
    expect(vaultSummary(vault)).toMatch(/read-only/)
  })

  it('describes local and example vaults without extra fields', () => {
    expect(vaultSummary({ id: 'l', name: 'Vault', kind: 'local' })).toBe('Folder on this device')
    expect(vaultSummary({ id: 'example', name: 'Tutorial', kind: 'example' })).toMatch(/Sample notes/)
  })
})

describe('attentionLabel', () => {
  it('gives every attention kind a distinct short label', () => {
    const labels = (['reauth', 'access', 'fs-permission', 'config'] as const).map(attentionLabel)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
