import { fireEvent, render, screen } from '@testing-library/react'
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

  it('keeps the row to one line, with worktree options behind a popover', () => {
    render(<SessionContextRow strip={stripState()} />)

    // Visible inline: only the mode select and the options trigger. Stacking the
    // rest inline shifted the composer whenever the mode changed.
    expect(screen.getByLabelText('Session environment mode')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Worktree options/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Worktree base branch')).not.toBeInTheDocument()
    expect(screen.queryByText('Start from origin')).not.toBeInTheDocument()
  })

  it('reveals base branch and start-from-origin inside the popover', () => {
    render(<SessionContextRow strip={stripState()} />)

    fireEvent.click(screen.getByRole('button', { name: /Worktree options/ }))

    expect(screen.getByLabelText('Worktree base branch')).toBeInTheDocument()
    expect(screen.getByText('Start from origin')).toBeInTheDocument()
  })

  it('shows the base ref on the trigger so the row still states where it runs', () => {
    render(<SessionContextRow strip={stripState({ baseRef: 'develop' })} />)
    expect(screen.getByRole('button', { name: /base branch develop/ })).toBeInTheDocument()
  })

  it('offers no worktree options in local mode', () => {
    render(<SessionContextRow strip={stripState({ envMode: 'local' })} />)
    expect(screen.queryByRole('button', { name: /Worktree options/ })).not.toBeInTheDocument()
  })

  it('surfaces the send-block reason', () => {
    render(
      <SessionContextRow
        strip={stripState({ baseRef: null, sendPlan: { kind: 'blocked', reason: 'Pick a base' } })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a base')
  })

  it('loads change requests when the checkout control is clicked', async () => {
    const loadChangeRequests = vi.fn(async () => {})
    render(<SessionContextRow strip={stripState({ loadChangeRequests })} />)
    fireEvent.click(screen.getByRole('button', { name: /Worktree options/ }))
    screen.getByRole('button', { name: /checkout change request/i }).click()
    expect(loadChangeRequests).toHaveBeenCalled()
  })

  it('checks out a selected change request', () => {
    const checkoutChangeRequest = vi.fn(async () => true)
    render(
      <SessionContextRow
        strip={stripState({
          checkoutChangeRequest,
          changeRequests: [
            {
              title: 'Fix bug',
              url: 'https://x/1',
              baseRef: 'main',
              headRef: 'fix',
              state: 'open',
            },
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Worktree options/ }))
    const select = screen.getByLabelText('Checkout change request')
    fireEvent.change(select, { target: { value: 'fix' } })
    expect(checkoutChangeRequest).toHaveBeenCalledWith('fix')
  })
})
