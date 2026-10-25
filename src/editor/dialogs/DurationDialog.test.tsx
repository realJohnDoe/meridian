// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DurationDialog from './DurationDialog'
import { setupStore } from '@/test-utils'

setupStore()

function renderOpen() {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  const props = { value: '', scheduled: null, itemType: 'task' as const, onConfirm, onRemove: vi.fn(), onClose }
  const { rerender } = render(<DurationDialog {...props} open={false} />)
  rerender(<DurationDialog {...props} open={true} />)
  return { onConfirm, onClose }
}

describe('DurationDialog presets', () => {
  it('stages a preset instead of committing it; Set commits and closes', () => {
    const { onConfirm, onClose } = renderOpen()

    fireEvent.click(screen.getByText('45m'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    expect(onConfirm).toHaveBeenCalledWith('45 minutes')
    expect(onClose).toHaveBeenCalled()
  })
})
