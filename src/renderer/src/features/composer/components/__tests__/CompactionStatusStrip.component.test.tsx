import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompactionStatusStrip } from '../CompactionStatusStrip'

describe('CompactionStatusStrip', () => {
  it('renders retry feedback and cancels through the stop action', () => {
    const cancel = vi.fn()
    render(
      <CompactionStatusStrip
        state={{
          type: 'retrying',
          attempt: 1,
          maxAttempts: 2,
          delayMs: 2500,
          errorMessage: 'context overflow',
        }}
        onCancel={cancel}
      />,
    )

    expect(screen.getByText('Retrying (1/2) in 3s…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel retry' }))
    expect(cancel).toHaveBeenCalledOnce()
  })
})
