import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionContextRowState } from '@/features/git/hooks/useSessionContextRow'
import { SessionContextRow } from '../SessionContextRow'

function stripState(overrides: Partial<SessionContextRowState> = {}): SessionContextRowState {
  return {
    visible: true,
    editable: true,
    envMode: 'worktree',
    baseRef: 'main',
    worktreePath: null,
    startFromOrigin: false,
    branchNames: ['main', 'develop'],
    branchStatus: 'ready',
    changeRequests: [],
    sendPlan: { kind: 'create-worktree', baseRef: 'main' },
    setEnvMode: vi.fn(),
    setBaseRef: vi.fn(),
    setStartFromOrigin: vi.fn(),
    loadChangeRequests: vi.fn(async () => {}),
    checkoutChangeRequest: vi.fn(async () => true),
    recreateWorktree: vi.fn(async () => true),
    switchToLocalMode: vi.fn(),
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

    expect(
      screen.getByRole('button', { name: 'Session environment mode: New worktree' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /options/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Worktree base branch')).not.toBeInTheDocument()
    expect(screen.queryByText('Start from origin')).not.toBeInTheDocument()
    expect(screen.queryByText('develop')).not.toBeInTheDocument()
  })

  it('shows resolved environment context without an editable control after first send', () => {
    render(<SessionContextRow strip={stripState({ editable: false })} />)

    expect(screen.getByTitle('Session environment: New worktree')).toHaveTextContent(
      'Local worktree',
    )
    expect(
      screen.queryByRole('button', { name: /Session environment mode/ }),
    ).not.toBeInTheDocument()
  })

  it('changes environment mode from an OpenWaggle menu instead of a native select', () => {
    const setEnvMode = vi.fn()
    render(<SessionContextRow strip={stripState({ setEnvMode })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Session environment mode: New worktree' }))
    expect(screen.getByRole('menu')).toHaveClass('mb-3')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Current checkout/ }))

    expect(setEnvMode).toHaveBeenCalledWith('local')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('surfaces the send-block reason', () => {
    render(
      <SessionContextRow
        strip={stripState({ baseRef: null, sendPlan: { kind: 'blocked', reason: 'Pick a base' } })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a base')
  })

  /**
   * Criterion 6: a vanished worktree stops the send and offers both ways out. Without
   * this the agent silently receives a fresh empty tree and the session's earlier work
   * is gone with no UI signal.
   */
  it('offers recreate and use-checkout when the worktree has vanished', () => {
    const recreateWorktree = vi.fn(async () => true)
    const switchToLocalMode = vi.fn()
    render(
      <SessionContextRow
        strip={stripState({
          recreateWorktree,
          switchToLocalMode,
          sendPlan: { kind: 'worktree-missing', reason: 'Worktree is gone.' },
        })}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Worktree is gone.')

    fireEvent.click(screen.getByRole('button', { name: 'Recreate worktree' }))
    expect(recreateWorktree).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Use current checkout' }))
    expect(switchToLocalMode).toHaveBeenCalled()
  })
})
