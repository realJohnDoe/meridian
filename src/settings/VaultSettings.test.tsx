// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { useStore, emptySyncStatus } from '@/store'
import { setupStore, installFakePersistence, seedStore, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { entryKey } from '@/fileIO'
import type { Roots } from '@/types'
import type { VaultRef } from '@/vaultRef'
import { setVaultColor, setVaultRetentionDays } from '@/vaultActions'
import type * as VaultActions from '@/vaultActions'
import { VaultSettings } from './VaultSettings'

// Only setVaultColor/setVaultRetentionDays are faked — everything else
// (exportVaultIcs et al.) stays real, since the export test below exercises
// it for real. Faking just these two sidesteps a real Dexie/IndexedDB write,
// which jsdom has no backing store for.
vi.mock('@/vaultActions', async (importOriginal) => ({
  ...(await importOriginal<typeof VaultActions>()),
  setVaultColor: vi.fn(),
  setVaultRetentionDays: vi.fn(),
}))

// The archived list's rows are real `Link`s (see keyRoute), which need a
// live router context `Link` itself can't get from a plain RTL render —
// jsdom throws deep inside useLinkProps without one. Stubbed to a plain
// anchor that reconstructs keyRoute's actual href from its known shape
// (`to: '/entry/$vault/$slug', params: { vault, slug }`), so the archived
// tests below can assert on where the link really points, not just that
// something renders.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    Link: ({ children, className, to, params }: {
      children: React.ReactNode
      className?: string
      to?: string
      params?: { vault?: string; slug?: string }
    }) => (
      <a
        className={className}
        href={to === '/entry/$vault/$slug' && params ? `/entry/${params.vault}/${params.slug}` : String(to)}
      >
        {children}
      </a>
    ),
  }
})

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

describe('VaultSettings — auto-archive', () => {
  afterEach(() => { vi.mocked(setVaultRetentionDays).mockClear() })

  it('shows the current retentionDays value', () => {
    render(<VaultSettings vault={{ ...GITHUB_VAULT, retentionDays: 30 }} />)
    expect(screen.getByPlaceholderText('Off')).toHaveValue(30)
  })

  it('is blank when retentionDays is unset', () => {
    render(<VaultSettings vault={GITHUB_VAULT} />)
    expect(screen.getByPlaceholderText('Off')).toHaveValue(null)
  })

  it('sets retentionDays on blur after a valid value is typed', () => {
    render(<VaultSettings vault={GITHUB_VAULT} />)
    const input = screen.getByPlaceholderText('Off')
    fireEvent.change(input, { target: { value: '14' } })
    fireEvent.blur(input)
    expect(setVaultRetentionDays).toHaveBeenCalledWith(GITHUB_VAULT.id, 14)
  })

  it('clears retentionDays on blur when the field is emptied', () => {
    render(<VaultSettings vault={{ ...GITHUB_VAULT, retentionDays: 30 }} />)
    const input = screen.getByPlaceholderText('Off')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(setVaultRetentionDays).toHaveBeenCalledWith(GITHUB_VAULT.id, null)
  })

  it('treats a non-positive value as clearing it, not as zero', () => {
    render(<VaultSettings vault={{ ...GITHUB_VAULT, retentionDays: 30 }} />)
    const input = screen.getByPlaceholderText('Off')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(setVaultRetentionDays).toHaveBeenCalledWith(GITHUB_VAULT.id, null)
  })

  it('does not call the action when the value is unchanged', () => {
    render(<VaultSettings vault={{ ...GITHUB_VAULT, retentionDays: 30 }} />)
    const input = screen.getByPlaceholderText('Off')
    fireEvent.blur(input)
    expect(setVaultRetentionDays).not.toHaveBeenCalled()
  })

  it('hides the row for the Tutorial vault (not writable)', () => {
    render(<VaultSettings vault={{ id: 'example', name: 'Tutorial', kind: 'example' }} />)
    expect(screen.queryByPlaceholderText('Off')).not.toBeInTheDocument()
  })

  it('hides the row for an iCal subscription (not writable)', () => {
    render(<VaultSettings vault={{ id: 'cal', name: 'Calendar', kind: 'ical', ical: { url: 'https://example.com/feed.ics' } }} />)
    expect(screen.queryByPlaceholderText('Off')).not.toBeInTheDocument()
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

  // seedStore replaces the whole store on each call, so seeding several
  // entries at once (for the collapse-threshold tests below) needs its own
  // helper rather than calling seedArchived in a loop.
  function seedArchivedMany(entries: Array<{ slug: string; title: string }>) {
    const occs = entries.map(({ slug, title }) =>
      makeOcc({ entryKey: testKey(slug), metadata: { vaultId: TEST_VAULT, fileSlug: slug, participants: [], title, tags: [], items: [] } }))
    const roots: Roots = new Map(entries.map(({ slug, title }) =>
      [testKey(slug), { title, tags: [], items: [], vaultId: TEST_VAULT, fileSlug: slug, archived: true }]))
    seedStore(occs, roots)
  }

  it('shows a friendly empty state when nothing is archived', () => {
    render(<VaultSettings vault={LOCAL_VAULT} />)
    expect(screen.getByText(/show up here/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /unarchive/i })).not.toBeInTheDocument()
  })

  it('lists archived entries as links to the entry, with a count', () => {
    seedArchived('old-task', 'Old Task')

    render(<VaultSettings vault={LOCAL_VAULT} />)

    expect(screen.getByRole('link', { name: 'Old Task' })).toHaveAttribute('href', `/entry/${TEST_VAULT}/old-task`)
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

  it('shows the list directly, with no disclosure, at the collapse threshold', () => {
    seedArchivedMany([1, 2, 3, 4, 5].map(n => ({ slug: `task-${n}`, title: `Task ${n}` })))

    render(<VaultSettings vault={LOCAL_VAULT} />)

    expect(screen.queryByRole('button', { name: /show.*archived/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(5)
  })

  it('hides the list behind a disclosure once it passes the threshold, and reveals it on click', () => {
    seedArchivedMany([1, 2, 3, 4, 5, 6].map(n => ({ slug: `task-${n}`, title: `Task ${n}` })))

    render(<VaultSettings vault={LOCAL_VAULT} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Show 6 archived entries' })

    fireEvent.click(trigger)

    expect(screen.getAllByRole('link')).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Hide archived entries' })).toBeInTheDocument()
  })
})
