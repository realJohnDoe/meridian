import { describe, it, expect } from 'vitest'
import { encodeHandoff, parseHandoff, isHandoffPresent } from '../vaultHandoff'
import type { VaultRef } from '@/vaultRef'

const vaults: VaultRef[] = [
  { id: 'a', name: 'acme/notes', kind: 'github', github: { owner: 'acme', repo: 'notes', branch: 'main' } },
  { id: 'b', name: 'acme/two', kind: 'github', github: { owner: 'acme', repo: 'two', branch: 'dev' } },
  { id: 'c', name: 'Holidays ✓', kind: 'ical', ical: { url: 'https://example.com/h.ics' } },
  { id: 'd', name: 'Docs', kind: 'local' },
  { id: 'e', name: 'Tutorial', kind: 'example' },
]

const frag = (v: unknown) => '#reconnect=' + btoa(JSON.stringify(v))

describe('vault handoff', () => {
  it('round-trips vault references, skipping the example vault', () => {
    expect(parseHandoff(encodeHandoff(vaults))).toEqual([
      { kind: 'github', name: 'acme/notes', github: { owner: 'acme', repo: 'notes', branch: 'main' } },
      { kind: 'github', name: 'acme/two', github: { owner: 'acme', repo: 'two', branch: 'dev' } },
      { kind: 'ical', name: 'Holidays ✓', ical: { url: 'https://example.com/h.ics' } },
      { kind: 'local', name: 'Docs' },
    ])
  })

  it('carries no token even if the ref had extra fields', () => {
    const ref = { ...vaults[0], token: 'ghp_secret' } as unknown as VaultRef
    const parsed = JSON.stringify(parseHandoff(encodeHandoff([ref])))
    expect(parsed).not.toContain('ghp_secret')
  })

  it('ignores other hashes', () => {
    expect(parseHandoff('')).toBeUndefined()
    expect(parseHandoff('#top')).toBeUndefined()
  })

  it.each([
    ['not base64', '#reconnect=!!!'],
    ['not json', '#reconnect=' + btoa('nope')],
    ['not an array', frag({})],
    ['unknown kind', frag([{ kind: 'example', name: 'x' }])],
    ['javascript url', frag([{ kind: 'ical', name: 'x', ical: { url: 'javascript:alert(1)' } }])],
    ['missing repo', frag([{ kind: 'github', name: 'x', github: { owner: 'a', branch: 'm' } }])],
    ['one bad entry poisons all', frag([{ kind: 'local', name: 'ok' }, { kind: 'local' }])],
    ['too long', '#reconnect=' + 'A'.repeat(30_000)],
  ])('rejects %s', (_n, hash) => {
    expect(parseHandoff(hash)).toBeNull()
  })

  it('detects vaults already present', () => {
    const list = parseHandoff(encodeHandoff(vaults)) ?? []
    expect(list.map(v => isHandoffPresent(v, vaults))).toEqual([true, true, true, true])
    expect(list.map(v => isHandoffPresent(v, []))).toEqual([false, false, false, false])
  })
})
