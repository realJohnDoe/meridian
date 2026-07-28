// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { setMediaQuery } from '@/test-utils'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
} from './responsive-modal'

// Which shell rendered is asserted through classes ResponsiveModal itself
// applies, not through Radix/vaul internals: the Dialog branch sets
// `p-0 gap-0` on its content and small-caps `uppercase` on its title, the
// Drawer branch sets `pt-3` and leaves the title unstyled. Both shells render
// role="dialog", so the role alone can't tell them apart.
const isDialogShell = () => screen.getByRole('dialog').className.includes('gap-0')

function renderModal(forceDialog?: boolean) {
  const onSet = vi.fn()
  render(
    <ResponsiveModal open onOpenChange={() => {}} forceDialog={forceDialog}>
      <ResponsiveModalContent>
        <ResponsiveModalTitle>Pick a time</ResponsiveModalTitle>
        <ResponsiveModalDescription>Choose a start time</ResponsiveModalDescription>
        <ResponsiveModalActions onRemove={() => {}} onCancel={() => {}} onSet={onSet} />
      </ResponsiveModalContent>
    </ResponsiveModal>,
  )
  return { onSet }
}

describe('ResponsiveModal — below the desktop breakpoint', () => {
  setMediaQuery(false)

  it('renders the Drawer shell', () => {
    renderModal()
    expect(isDialogShell()).toBe(false)
    expect(screen.getByRole('dialog').className).toContain('pt-3')
  })

  // Both shells give the title the same small-caps treatment; only the Dialog
  // needs the extra right padding, because only it has a built-in close button
  // for the text to run into.
  it('propagates the drawer branch to the title, which needs no close-button gutter', () => {
    renderModal()
    const title = screen.getByText('Pick a time')
    expect(title).toHaveClass('uppercase')
    expect(title).not.toHaveClass('pr-10')
  })

  it('forceDialog overrides the breakpoint', () => {
    renderModal(true)
    expect(isDialogShell()).toBe(true)
  })
})

describe('ResponsiveModal — at or above the desktop breakpoint', () => {
  setMediaQuery(true)

  it('renders the Dialog shell', () => {
    renderModal()
    expect(isDialogShell()).toBe(true)
    expect(screen.getByRole('dialog').className).toContain('sm:max-w-sm')
  })

  it('propagates the dialog branch to the title, which gets a gutter for the close button', () => {
    renderModal()
    const title = screen.getByText('Pick a time')
    expect(title).toHaveClass('uppercase')
    expect(title).toHaveClass('pr-10')
  })
})

describe('ResponsiveModal — shared behaviour', () => {
  const setDesktop = setMediaQuery(true)

  it('keeps the description available to screen readers only, in both shells', () => {
    renderModal()
    expect(screen.getByText('Choose a start time')).toHaveClass('sr-only')
  })

  it('renders the same Remove / Cancel / Set row in both shells, adding bottom padding only on desktop', () => {
    const { onSet } = renderModal()
    const footer = screen.getByRole('button', { name: 'Set' }).parentElement?.parentElement
    expect(footer?.className).toContain('pb-4')
    for (const name of ['Remove', 'Cancel', 'Set']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }

    act(() => setDesktop(false))

    expect(screen.getByRole('button', { name: 'Set' }).parentElement?.parentElement?.className)
      .not.toContain('pb-4')
    expect(onSet).not.toHaveBeenCalled()
  })

  // useMediaQuery subscribes via useSyncExternalStore, so a live breakpoint
  // crossing must swap the shell on an already-mounted modal. The default stub
  // in test-utils/setup.ts registers no listeners, so this can only be
  // exercised through setMediaQuery.
  it('swaps shells when the breakpoint is crossed while open', () => {
    renderModal()
    expect(isDialogShell()).toBe(true)

    act(() => setDesktop(false))

    expect(isDialogShell()).toBe(false)
  })
})
