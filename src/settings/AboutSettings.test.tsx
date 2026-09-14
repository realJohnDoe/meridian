// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AboutSettings from './AboutSettings'

describe('AboutSettings', () => {
  it('shows the app name and build version', () => {
    render(<AboutSettings />)

    expect(screen.getByText('Meridian')).toBeInTheDocument()
    expect(screen.getByText('test')).toBeInTheDocument() // __APP_VERSION__, stubbed for tests
  })

  it('links to the source repository', () => {
    render(<AboutSettings />)

    expect(screen.getByRole('link', { name: /Source code/ })).toHaveAttribute(
      'href', 'https://github.com/realJohnDoe/meridian',
    )
  })

  it('links to the MIT license on the repository', () => {
    render(<AboutSettings />)

    const link = screen.getByRole('link', { name: /License/ })
    expect(link).toHaveAttribute('href', 'https://github.com/realJohnDoe/meridian/blob/main/LICENSE')
    expect(link).toHaveTextContent('MIT')
  })

  it('links to the issue tracker for feedback', () => {
    render(<AboutSettings />)

    expect(screen.getByRole('link', { name: /Report an issue/ })).toHaveAttribute(
      'href', 'https://github.com/realJohnDoe/meridian/issues',
    )
  })

  it('opens every link in a new tab', () => {
    render(<AboutSettings />)

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
    }
  })
})
