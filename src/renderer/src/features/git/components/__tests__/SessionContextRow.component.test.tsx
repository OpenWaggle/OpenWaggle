import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionContextRowState } from '@/features/git/hooks/useSessionContextRow'
import { SessionContextRow } from '../SessionContextRow'

function stripState(overrides: Partial<SessionContextRowState> = {}): SessionContextRowState {
  return {
    visible: true,
    envMode: 'worktree',
    baseRef: 'main',
    startFromOrigin: false,
    branchNames: ['main', 'develop'],
    changeRequests: [],
    sendPlan: { kind: 'create-worktree', baseRef: 'main' },
    setEnvMode: vi.fn(),
    setBaseRef: vi.fn(),
    setStartFromOrigin: vi.fn(),
    loadChangeRequests: vi.fn(async () => {}),
    checkoutChangeRequest: vi.fn(async () => true),
    ...overrides,
  }
}

describe('SessionContextRow', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<SessionContextRow strip={stripState({ visible: false })} />)
    expect(container).toBeEmptyDOMElement()
  })

  // Regression guard for the selector consolidation: this half of the row owns the
  // environment mode ONLY. The ref is owned by the single run-target picker, so no
  // branch string and no second "Options" popover may appear here.
  it('shows the environment mode and nothing that names a ref', () => {
    render(<SessionContextRow strip={stripState({ baseRef: 'develop' })} />)

    expect(screen.getByLabelText('Session environment mode')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /options/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Worktree base branch')).not.toBeInTheDocument()
    expect(screen.queryByText('Start from origin')).not.toBeInTheDocument()
    expect(screen.queryByText('develop')).not.toBeInTheDocument()
  })

  it('surfaces the send-block reason', () => {
    render(
      <SessionContextRow
        strip={stripState({ baseRef: null, sendPlan: { kind: 'blocked', reason: 'Pick a base' } })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a base')
  })
})
