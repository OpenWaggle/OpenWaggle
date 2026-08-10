import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComposerContextStripState } from '@/features/git/hooks/useComposerContextStrip'
import { ComposerContextStrip } from '../ComposerContextStrip'

function stripState(overrides: Partial<ComposerContextStripState> = {}): ComposerContextStripState {
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

describe('ComposerContextStrip', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<ComposerContextStrip strip={stripState({ visible: false })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows env-mode and base-branch selectors in worktree mode', () => {
    render(<ComposerContextStrip strip={stripState()} />)
    expect(screen.getByLabelText('Session environment mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Worktree base branch')).toBeInTheDocument()
  })

  it('hides the base-branch selector in local mode', () => {
    render(<ComposerContextStrip strip={stripState({ envMode: 'local' })} />)
    expect(screen.queryByLabelText('Worktree base branch')).not.toBeInTheDocument()
  })

  it('surfaces the send-block reason', () => {
    render(
      <ComposerContextStrip
        strip={stripState({ baseRef: null, sendPlan: { kind: 'blocked', reason: 'Pick a base' } })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a base')
  })

  it('loads change requests when the checkout control is clicked', async () => {
    const loadChangeRequests = vi.fn(async () => {})
    render(<ComposerContextStrip strip={stripState({ loadChangeRequests })} />)
    screen.getByRole('button', { name: /checkout change request/i }).click()
    expect(loadChangeRequests).toHaveBeenCalled()
  })

  it('checks out a selected change request', () => {
    const checkoutChangeRequest = vi.fn(async () => true)
    render(
      <ComposerContextStrip
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
    const select = screen.getByLabelText('Checkout change request')
    fireEvent.change(select, { target: { value: 'fix' } })
    expect(checkoutChangeRequest).toHaveBeenCalledWith('fix')
  })
})
