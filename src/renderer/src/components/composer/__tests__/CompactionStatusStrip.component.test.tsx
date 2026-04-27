import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompactionStatusStrip } from '../CompactionStatusStrip'

const COMPACTION_CASES = [
  ['manual', 'Compacting context…'],
  ['threshold', 'Auto-compacting…'],
  ['overflow', 'Context overflow detected, auto-compacting…'],
] as const

describe('CompactionStatusStrip', () => {
  it.each(
    COMPACTION_CASES,
  )('renders Pi-style compaction copy for %s compaction', (reason, label) => {
    render(<CompactionStatusStrip state={{ type: 'compacting', reason }} onCancel={vi.fn()} />)

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel compaction' })).toBeInTheDocument()
  })

  it('renders retry feedback and cancels through the same stop action', () => {
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
