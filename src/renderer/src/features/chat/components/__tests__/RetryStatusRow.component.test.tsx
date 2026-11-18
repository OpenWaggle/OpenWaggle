import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusRow } from '../AgentLoopStatusRow'

describe('retry status row', () => {
  it('renders retry progress as transcript text without a second Stop control', () => {
    render(
      <StatusRow
        row={{ type: 'retry-status', attempt: 1, maxAttempts: 2, delayMs: 2_500 }}
        extensions={{ registry: null, projectPaths: [] }}
      />,
    )

    expect(screen.getByText('Retrying (1/2) in 3s…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
