// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore, emptySyncStatus } from '@/store'
import { setupStore, installFakePersistence, seedStore, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { entryKey } from '@/fileIO'
import type { VaultRef } from '@/vaultRef'
import { setVaultColor } from '@/vaultActions'
import type * as VaultActions from '@/vaultActions'
import { VaultSettings } from './VaultSettings'

// Only setVaultColor is faked — everything else (exportVaultIcs et al.) stays
// real, since the export test below exercises it for real. Faking just this
// one export sidesteps a real Dexie/IndexedDB write, which jsdom has no
// backing store for.
vi.mock('@/vaultActions', async (importOriginal) => ({
  ...(await importOriginal<typeof VaultActions>()),
  setVaultColor: vi.fn(),
}))

setupStore()

const GITHUB_VAULT: VaultRef = {
  id: 'gh-vault', name: 'Work', kind: 'github',
  github: { owner: 'acme', repo: 'notes', branch: 'main' },
}

describe('VaultSettings — export', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('downloads the vault as a sanitized-filename .ics via an object URL', async () => {
    // jsdom has no real Blob-URL machinery; stub just enough to observe the download.
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<VaultSettings vault={{ ...GITHUB_VAULT, name: 'Work/Life: 2026' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Export \.ics/ }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]!
    expect(blob.type).toBe('text/calendar;charset=utf-8')
    expect(await blob.text()).toContain('BEGIN:VCALENDAR')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')

    const [a] = click.mock.instances as [HTMLAnchorElement]
    expect(a.download).toBe('Work-Life- 2026.ics')
  })
})

describe('VaultSettings — color', () => {
  afterEach(() => { vi.mocked(setVaultColor).mockClear() })

  it('marks "No color" pressed when the vault has none set', () => {
    render(<VaultSettings vault={GITHUB_VAULT} />)
    expect(screen.getByRole('button', { name: 'No color' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks the matching swatch pressed when the vault has a color set', () => {
    render(<VaultSettings vault={{ ...GITHUB_VAULT, color: 'blue' }} />)
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'No color' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('sets the color when a swatch is clicked', () => {
    render(<VaultSettings vault={GITHUB_VAULT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Red' }))
    expect(setVaultColor).toHaveBeenCalledWith(GITHUB_VAULT.id, 'red')
  })

  it('clears the color when "No color" is clicked', () => {
    render(<VaultSettings vault={{ ...GITHUB_VAULT, color: 'red' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'No color' }))
    expect(setVaultColor).toHaveBeenCalledWith(GITHUB_VAULT.id, null)
  })

  it('hides the color picker for the Tutorial vault', () => {
    render(<VaultSettings vault={{ id: 'example', name: 'Tutorial', kind: 'example' }} />)
    expect(screen.queryByRole('button', { name: 'No color' })).not.toBeInTheDocument()
  })
})

describe('VaultSettings — GitHub attention rows', () => {
  it('renders a reauth row that offers to sign in again', () => {
    useStore.setState({
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'reauth', message: 'x' },
      }]]),
    })
    render(<VaultSettings vault={GITHUB_VAULT} />)

    expect(screen.getByRole('button', { name: /Signed out of GitHub — sign in again/ })).toBeInTheDocument()
  })

  it('mirrors the access row as a link to the App install page', () => {
    useStore.setState({
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'access', message: 'x' },
      }]]),
    })
    render(<VaultSettings vault={GITHUB_VAULT} />)

    const link = screen.getByRole('link', { name: /Meridian no longer has access to acme\/notes/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('github.com/apps/'))
  })

  it('mirrors the config row as plain informational text', () => {
    useStore.setState({
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'config', message: 'x' },
      }]]),
    })
    render(<VaultSettings vault={GITHUB_VAULT} />)

    expect(screen.getByText(/acme\/notes \(main\) isn.t reachable/)).toBeInTheDocument()
  })

  it('shows neither row once needsAttention clears', () => {
    useStore.setState({
      syncByVault: new Map([[GITHUB_VAULT.id, emptySyncStatus()]]),
    })
    render(<VaultSettings vault={GITHUB_VAULT} />)

    expect(screen.queryByText(/no longer has access/)).not.toBeInTheDocument()
    expect(screen.queryByText(/isn.t reachable/)).not.toBeInTheDocument()
  })
})

// plans/archived-entries.md PR 3 — the vault's own escape hatch for an
// archived entry nothing links to.
describe('VaultSettings — archived', () => {
  installFakePersistence()

  // TEST_VAULT, not GITHUB_VAULT above: makeOcc/testKey/makeRoots default to
  // it, and the row only lists entries whose root.vaultId matches vault.id.
  const LOCAL_VAULT: VaultRef = { id: TEST_VAULT, name: 'Notes', kind: 'local' }

  function seedArchived(slug: string, title: string) {
    const occ = makeOcc({ entryKey: testKey(slug), metadata: { vaultId: TEST_VAULT, fileSlug: slug, participants: [], title, tags: [], items: [] } })
    seedStore([occ], makeRoots(slug, { title, archived: true }))
  }

  it('shows a friendly empty state when nothing is archived', () => {
    render(<VaultSettings vault={LOCAL_VAULT} />)
    expect(screen.getByText(/show up here/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /unarchive/i })).not.toBeInTheDocument()
  })

  it('lists archived entries by title, with a count', () => {
    seedArchived('old-task', 'Old Task')

    render(<VaultSettings vault={LOCAL_VAULT} />)

    expect(screen.getByText('Old Task')).toBeInTheDocument()
    expect(screen.getByText(/1 entry is hidden/i)).toBeInTheDocument()
  })

  it('unarchiving clears the flag in the store', () => {
    seedArchived('old-task', 'Old Task')

    render(<VaultSettings vault={LOCAL_VAULT} />)
    fireEvent.click(screen.getByRole('button', { name: /unarchive/i }))

    expect(useStore.getState().roots.get(testKey('old-task'))?.archived).toBeUndefined()
  })

  // A vault only ever sees its own archived entries — plans/archived-entries.md
  // PR 3 is explicit that the list is per vault, not global.
  it('never lists another vault\'s archived entry', () => {
    const otherKey = entryKey('other-vault', 'stray')
    const otherOcc = makeOcc({ entryKey: otherKey, metadata: { vaultId: 'other-vault', fileSlug: 'stray', participants: [], title: 'Stray', tags: [], items: [] } })
    seedStore([otherOcc], new Map([[otherKey, { title: 'Stray', tags: [], items: [], vaultId: 'other-vault', fileSlug: 'stray', archived: true }]]))

    render(<VaultSettings vault={LOCAL_VAULT} />)

    expect(screen.queryByText('Stray')).not.toBeInTheDocument()
  })
})
