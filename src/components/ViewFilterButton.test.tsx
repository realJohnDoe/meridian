// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore, makeOcc } from '@/test-utils'
import { entryKey } from '@/fileIO'
import type { Occurrence } from '@/types'
import type { VaultRef } from '@/vaultRef'
import ViewFilterButton from './ViewFilterButton'

setupStore()

const VAULT_A: VaultRef = { id: 'vault-a', name: 'Family', kind: 'local' }
const VAULT_B: VaultRef = { id: 'vault-b', name: 'Work', kind: 'local' }

function occIn(vaultId: string, slug: string, participants: string[]): Occurrence {
  return makeOcc({
    entryKey: entryKey(vaultId, slug),
    metadata: { vaultId, fileSlug: slug, title: slug, tags: [], items: [], participants },
  })
}

/** The trigger's aria-label reads differently active vs. inactive; this matches both. */
function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: /calendars? and people/i }))
}

/** The row `<div>` that holds one vault's chevron, checkbox and name — the
 *  nearest `div` ancestor of its name text, and nothing from sibling rows or
 *  the (sibling, not ancestor) CollapsibleContent below it. */
function vaultRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest('div')
  if (!row) throw new Error(`no row div found for ${name}`)
  return row
}

describe('ViewFilterButton', () => {
  it('collapses to a flat person list for a single vault', () => {
    useStore.setState({
      vaults: [VAULT_A],
      items: [occIn(VAULT_A.id, 'a', ['Alice']), occIn(VAULT_A.id, 'b', ['Bob'])],
    })
    render(<ViewFilterButton />)
    openPopover()

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.queryByText('Family')).not.toBeInTheDocument()
  })

  it('shows one row per vault, each collapsed by default, once two vaults have participants', () => {
    useStore.setState({
      vaults: [VAULT_A, VAULT_B],
      items: [occIn(VAULT_A.id, 'a', ['Alice']), occIn(VAULT_B.id, 'b', ['Bob'])],
    })
    render(<ViewFilterButton />)
    openPopover()

    expect(screen.getByText('Family')).toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('renders the mixed vault checkbox as indeterminate with a dash glyph, not a checkmark', () => {
    useStore.setState({
      vaults: [VAULT_A, VAULT_B],
      items: [occIn(VAULT_A.id, 'a', ['Alice']), occIn(VAULT_A.id, 'b', ['Bob']), occIn(VAULT_B.id, 'c', ['Carol'])],
      hiddenParticipants: { [VAULT_A.id]: ['Alice'] },
    })
    render(<ViewFilterButton />)
    openPopover()

    const familyCheckbox = within(vaultRow('Family')).getByRole('checkbox')
    expect(familyCheckbox).toHaveAttribute('data-state', 'indeterminate')
    expect(within(vaultRow('Family')).getByRole('checkbox').querySelector('.lucide-minus')).toBeTruthy()

    const workCheckbox = within(vaultRow('Work')).getByRole('checkbox')
    expect(workCheckbox).toHaveAttribute('data-state', 'checked')
  })

  it('clicking a mixed vault checkbox shows everyone in that vault, without hiding the vault itself', () => {
    useStore.setState({
      vaults: [VAULT_A, VAULT_B],
      items: [occIn(VAULT_A.id, 'a', ['Alice']), occIn(VAULT_A.id, 'b', ['Bob']), occIn(VAULT_B.id, 'c', ['Carol'])],
      hiddenParticipants: { [VAULT_A.id]: ['Alice'] },
    })
    render(<ViewFilterButton />)
    openPopover()

    fireEvent.click(within(vaultRow('Family')).getByRole('checkbox'))

    expect(useStore.getState().hiddenParticipants[VAULT_A.id]).toEqual([])
    expect(useStore.getState().hiddenVaultIds).toEqual([])
  })

  it('clicking a fully-shown vault checkbox hides the whole vault', () => {
    useStore.setState({
      vaults: [VAULT_A, VAULT_B],
      items: [occIn(VAULT_A.id, 'a', ['Alice']), occIn(VAULT_B.id, 'c', ['Carol'])],
    })
    render(<ViewFilterButton />)
    openPopover()

    fireEvent.click(within(vaultRow('Family')).getByRole('checkbox'))

    expect(useStore.getState().hiddenVaultIds).toEqual([VAULT_A.id])
  })

  it('clicking a fully-hidden vault checkbox shows the vault again', () => {
    useStore.setState({
      vaults: [VAULT_A, VAULT_B],
      items: [occIn(VAULT_A.id, 'a', ['Alice']), occIn(VAULT_B.id, 'c', ['Carol'])],
      hiddenVaultIds: [VAULT_A.id],
    })
    render(<ViewFilterButton />)
    openPopover()

    fireEvent.click(within(vaultRow('Family')).getByRole('checkbox'))

    expect(useStore.getState().hiddenVaultIds).toEqual([])
  })

  it('expands a vault via its accessibly-labeled chevron to reveal its person rows', () => {
    useStore.setState({
      vaults: [VAULT_A, VAULT_B],
      items: [occIn(VAULT_A.id, 'a', ['Alice']), occIn(VAULT_B.id, 'c', ['Carol'])],
    })
    render(<ViewFilterButton />)
    openPopover()

    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Family' }))
    expect(screen.getByText('Alice')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Family' }))
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('disables the chevron for a registered vault with no entries at all', () => {
    useStore.setState({
      // VAULT_A is registered but has contributed no items yet — nothing to expand into.
      vaults: [VAULT_A, VAULT_B],
      items: [occIn(VAULT_B.id, 'c', ['Carol'])],
    })
    render(<ViewFilterButton />)
    openPopover()

    expect(screen.getByRole('button', { name: 'Expand Family' })).toBeDisabled()
  })

  it('keeps the chevron enabled when a vault has only the "no participants" row', () => {
    useStore.setState({
      vaults: [VAULT_A, VAULT_B],
      items: [occIn(VAULT_A.id, 'a', []), occIn(VAULT_B.id, 'c', ['Carol'])],
    })
    render(<ViewFilterButton />)
    openPopover()

    expect(screen.getByRole('button', { name: 'Expand Family' })).not.toBeDisabled()
  })
})
