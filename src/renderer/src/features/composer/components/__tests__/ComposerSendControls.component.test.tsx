import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerSendControls } from '../ComposerSendControls'

describe('ComposerSendControls', () => {
  // The agent is done and the Host is settling the Run: a Stop there has nothing to stop.
  it('says the Run is finishing instead of offering Cancel', () => {
    render(
      <ComposerSendControls isLoading isFinishing canSend onSend={vi.fn()} onCancel={vi.fn()} />,
    )

    expect(screen.queryByTitle('Cancel')).toBeNull()
    expect(screen.getByText('Finishing…')).toBeInTheDocument()
    // A message sent now is queued and starts once the Run has settled.
    expect(screen.getByTitle('Add message')).toBeInTheDocument()
  })

  it('offers Cancel while the Run is still working', () => {
    render(<ComposerSendControls isLoading canSend onSend={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByTitle('Cancel')).toBeInTheDocument()
    expect(screen.queryByText('Finishing…')).toBeNull()
  })
})
