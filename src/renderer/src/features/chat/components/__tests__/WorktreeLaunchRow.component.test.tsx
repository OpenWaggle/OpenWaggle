import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatDisplayPathProvider } from '../ChatDisplayPathContext'
import { WorktreeLaunchRow } from '../WorktreeLaunchRow'

const recoveryMocks = vi.hoisted(() => ({
  cancelFirstSend: vi.fn(async () => undefined),
  retryFirstSend: vi.fn(async () => undefined),
}))

vi.mock('../../lib/worktree-launch-recovery', () => recoveryMocks)

describe('WorktreeLaunchRow', () => {
  it('shows Codex-style setup stages, details, and recovery actions on failure', async () => {
    render(
      <WorktreeLaunchRow
        sessionId="session-a"
        launch={{
          status: 'failed',
          stage: 'checking-out-files',
          startedAt: 1,
          updatedAt: 2,
          details: ['Preparing the session worktree', 'git worktree add failed'],
          errorMessage: 'Could not check out files',
        }}
      />,
    )

    expect(screen.getByText('Preparing workspace')).toBeInTheDocument()
    expect(screen.getByText('Checking out files')).toBeInTheDocument()
    expect(screen.getByText('Could not check out files')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More details' }))
    expect(screen.getByText('git worktree add failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(recoveryMocks.retryFirstSend).toHaveBeenCalledWith('session-a'))
  })

  it('collapses successful setup to a durable Worktree created trace', () => {
    render(
      <WorktreeLaunchRow
        sessionId="session-a"
        launch={{
          status: 'complete',
          stage: 'starting-task',
          startedAt: 1,
          updatedAt: 2,
          details: ['Created ow/session-a from main'],
        }}
      />,
    )

    const trace = screen.getByRole('button', { name: /Worktree created/ })
    expect(trace).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trace)
    expect(screen.getByText('Created ow/session-a from main')).toBeInTheDocument()
  })

  it('shows the handoff from completed worktree setup to starting the task', () => {
    render(
      <WorktreeLaunchRow
        sessionId="session-a"
        launch={{
          status: 'running',
          stage: 'worktree-created',
          startedAt: 1,
          updatedAt: 2,
          details: ['Created ow/session-a from main'],
        }}
      />,
    )

    expect(screen.getByText('Worktree created')).toBeInTheDocument()
    expect(screen.getAllByText('Starting task')).toHaveLength(2)
    expect(screen.queryByText('Preparing workspace')).not.toBeInTheDocument()
  })

  it('marks Starting task as failed when setup fails after creating the worktree', () => {
    render(
      <WorktreeLaunchRow
        sessionId="session-a"
        launch={{
          status: 'failed',
          stage: 'worktree-created',
          startedAt: 1,
          updatedAt: 2,
          details: ['Created ow/session-a from main', 'Could not start the task'],
          errorMessage: 'Could not start the task',
        }}
      />,
    )

    expect(screen.getByText('Starting task').parentElement).toHaveAttribute('data-state', 'failed')
  })

  it('announces worktree progress and failure updates through a stable live region', () => {
    const { rerender } = render(
      <WorktreeLaunchRow
        sessionId="session-a"
        launch={{
          status: 'running',
          stage: 'preparing-workspace',
          startedAt: 1,
          updatedAt: 1,
          details: ['Preparing the session worktree'],
        }}
      />,
    )

    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveTextContent('Preparing workspace')

    rerender(
      <WorktreeLaunchRow
        sessionId="session-a"
        launch={{
          status: 'failed',
          stage: 'checking-out-files',
          startedAt: 1,
          updatedAt: 2,
          details: ['Could not check out files'],
          errorMessage: 'Could not check out files',
        }}
      />,
    )

    expect(screen.getByRole('status')).toBe(liveRegion)
    expect(liveRegion).toHaveTextContent('Worktree setup failed: Could not check out files')
  })

  it('does not expose the Session worktree storage path in details', () => {
    const worktreePath = '/Users/diego/.openwaggle/worktrees/OpenWaggle/session-a'
    render(
      <ChatDisplayPathProvider
        projectPath="/Users/diego/Projects/OpenWaggle"
        worktreePath={worktreePath}
      >
        <WorktreeLaunchRow
          sessionId="session-a"
          launch={{
            status: 'complete',
            stage: 'starting-task',
            startedAt: 1,
            updatedAt: 2,
            details: [`Created ${worktreePath}/src/main.ts`],
          }}
        />
      </ChatDisplayPathProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Worktree created/ }))
    expect(screen.getByText('Created src/main.ts')).toBeInTheDocument()
    expect(screen.queryByText(/\.openwaggle\/worktrees/)).toBeNull()
  })
})
