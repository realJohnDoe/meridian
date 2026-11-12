import { describe, it, expect } from 'vitest'
import { vaultKindOps } from '../vaultKinds'
import type { VaultRef } from '@/vaultRef'

const ICAL_REF: VaultRef = { id: 'ical-1', name: 'Holidays', kind: 'ical', ical: { url: 'https://example.com/a.ics' } }

describe('vaultKindOps notices', () => {
  it('words a refused calendar feed about the feed, not GitHub', () => {
    const msg = vaultKindOps(ICAL_REF).notices.denied(ICAL_REF.name)
    expect(msg).toContain('calendar feed')
    expect(msg).not.toContain('GitHub')
  })
})
