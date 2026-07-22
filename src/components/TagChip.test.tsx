// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TagChip from './TagChip'

describe('TagChip', () => {
  it('renders a plain tag chip with no remove button by default', () => {
    render(<TagChip label="urgent" />)
    expect(screen.getByText('urgent')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a topic chip with no underline or remove button when not interactive', () => {
    render(<TagChip label="Project X" isTopic />)
    expect(screen.getByText('Project X')).not.toHaveClass('underline')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('underlines an interactive topic chip and navigates on click', () => {
    const onNavigate = vi.fn()
    render(<TagChip label="Project X" isTopic interactive onNavigate={onNavigate} />)
    expect(screen.getByText('Project X')).toHaveClass('underline')

    fireEvent.click(screen.getByText('Project X'))

    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('does not navigate a plain (non-topic) chip even when interactive', () => {
    const onNavigate = vi.fn()
    render(<TagChip label="urgent" interactive onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('urgent'))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('shows a remove button in interactive mode for both tag and topic chips, and calls onRemove without onNavigate', () => {
    const onRemove = vi.fn()
    const onNavigate = vi.fn()
    render(<TagChip label="Project X" isTopic interactive onRemove={onRemove} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Project X' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('shows a remove button on a plain tag chip in interactive mode', () => {
    const onRemove = vi.fn()
    render(<TagChip label="urgent" interactive onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove urgent' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('omits the remove button when interactive but onRemove is not provided', () => {
    render(<TagChip label="urgent" interactive />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
