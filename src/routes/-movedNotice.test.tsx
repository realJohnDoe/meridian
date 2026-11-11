// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setupStore } from '@/test-utils'
import { useStore, emptySyncStatus } from '@/store'
import { MovedNotice } from './-movedNotice'

const OLD = 'https://realjohndoe.github.io'

describe('MovedNotice', () => {
  beforeEach(() => { setupStore() })

  it('shows on the old origin and can be dismissed', () => {
    render(<MovedNotice origin={OLD} />)
    expect(screen.getByText('Meridian has moved')).toBeTruthy()
    expect(screen.queryByText(/Sync first/)).toBeNull()
    fireEvent.click(screen.getByText('Dismiss'))
    expect(screen.queryByText('Meridian has moved')).toBeNull()
  })

  it('tells the user to sync first when a vault is dirty', () => {
    useStore.setState({ syncByVault: new Map([['v', { ...emptySyncStatus(), dirtyCount: 2 }]]) })
    render(<MovedNotice origin={OLD} />)
    expect(screen.getByText(/Sync first/)).toBeTruthy()
  })

  it('renders nothing on the new origin', () => {
    const { container } = render(<MovedNotice origin="https://meridian.realjohndoe.workers.dev" />)
    expect(container.innerHTML).toBe('')
  })
})
