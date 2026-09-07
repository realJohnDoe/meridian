// @vitest-environment jsdom
/**
 * Codebase health survey 2026-09-06, finding #9: `startGitHubSignIn` used to be
 * the one vault action that skipped the catch-and-notify convention every
 * sibling in `vaultRegistry.ts` follows, so a thrown `crypto.subtle.digest` or
 * `sessionStorage.setItem` dropped the rejection on the floor at all three call
 * sites instead of surfacing a toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { notifyFns } = vi.hoisted(() => ({
  notifyFns: { notify: vi.fn(), notifyError: vi.fn(), warn: vi.fn(), warnWithDetails: vi.fn() },
}))
vi.mock('@/storage/notifications', () => notifyFns)

import { startGitHubSignIn } from '@/storage/githubOAuth'

beforeEach(() => {
  notifyFns.notify.mockClear()
  notifyFns.notifyError.mockClear()
  sessionStorage.clear()
})

describe('startGitHubSignIn', () => {
  it('notifies instead of throwing when it fails before redirecting', async () => {
    const err = new Error('crypto unavailable')
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(err)

    await expect(startGitHubSignIn()).resolves.toBeUndefined()

    expect(notifyFns.notifyError).toHaveBeenCalledWith('Could not start GitHub sign-in', err)
  })

  it('redirects and does not notify on success', async () => {
    await startGitHubSignIn()

    expect(notifyFns.notifyError).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('meridian_oauth_verifier')).not.toBeNull()
  })
})
