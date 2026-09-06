// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AppearanceSettings from './AppearanceSettings'

const setTheme = vi.fn()
let mockTheme: { theme: string | undefined; systemTheme: string | undefined } = { theme: undefined, systemTheme: 'dark' }

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: mockTheme.theme, setTheme, systemTheme: mockTheme.systemTheme }) }))

describe('AppearanceSettings — theme cards', () => {
  it('renders every theme as a labeled, unpressed card by default', () => {
    mockTheme = { theme: undefined, systemTheme: 'dark' }
    render(<AppearanceSettings />)

    for (const label of ['System', 'Meridian Dark', 'Meridian Light', 'Dracula', 'Tokyo Night']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('marks "System" pressed when no theme is set', () => {
    mockTheme = { theme: undefined, systemTheme: 'dark' }
    render(<AppearanceSettings />)

    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Dracula' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks the matching card pressed when a theme is set', () => {
    mockTheme = { theme: 'dracula', systemTheme: 'dark' }
    render(<AppearanceSettings />)

    expect(screen.getByRole('button', { name: 'Dracula' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls setTheme with the clicked card\'s id', () => {
    mockTheme = { theme: 'dracula', systemTheme: 'dark' }
    render(<AppearanceSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Tokyo Night' }))
    expect(setTheme).toHaveBeenCalledWith('tokyo-night')
  })

  it('previews System using the dark branded theme when the OS resolves to dark', () => {
    mockTheme = { theme: undefined, systemTheme: 'dark' }
    render(<AppearanceSettings />)

    expect(screen.getByRole('button', { name: 'System' })).toHaveClass('meridian')
  })

  it('previews System using the light branded theme when the OS resolves to light', () => {
    mockTheme = { theme: undefined, systemTheme: 'light' }
    render(<AppearanceSettings />)

    expect(screen.getByRole('button', { name: 'System' })).toHaveClass('meridian-light')
  })
})
