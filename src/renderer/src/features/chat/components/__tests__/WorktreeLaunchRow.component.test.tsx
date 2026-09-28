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

function stepState(label: string) {
  return screen
    .getAllByText(label)
    .map((element) => element.parentElement?.getAttribute('data-state'))
    .find((state) => state !== null && state !== undefined)
}

describe('WorktreeLaunchRow launch steps', () => {
  it('renders each reported step for a worktree launch, Codex-style', () => {
    render(
      <WorktreeLaunchRow
        sessionId="session-a"
        launch={{
          status: 'running',
          stage: 'checking-out-files',
          environment: 'worktree',
          startedAt: 1,
          updatedAt: 3,
          details: [],
          steps: [
            {
              stage: 'fetching-base',
              label: 'Pulling latest main from origin',
              startedAt: 1,
              completedAt: 2,
            },
            {
              stage: 'checking-out-files',
              label: 'Creating worktree ow/session-a from origin/main',
              startedAt: 2,
            },
          ],
        }}
      />,
    )

    expect(stepState('Pulling latest main from origin')).toBe('complete')
    expect(stepState('Creating worktree ow/session-a from origin/main')).toBe('active')
    expect(stepState('Starting task')).toBe('pending')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Creating worktree ow/session-a from origin/main',
    )
  })

  it('shows a local launch without offering to work locally, and hides it once complete', () => {
    const local = {
      status: 'running' as const,
      stage: 'connecting-tools' as const,
      environment: 'local' as const,
      startedAt: 1,
      updatedAt: 2,
      details: [],
      steps: [
        {
          stage: 'syncing-branch' as const,
          label: 'Pulling latest changes for main',
          startedAt: 1,
          completedAt: 2,
        },
        {
          stage: 'connecting-tools' as const,
          label: 'Connecting MCP servers: atlassian',
          startedAt: 2,
        },
      ],
    }
    const { container, rerender } = render(
      <WorktreeLaunchRow sessionId="session-a" launch={local} />,
    )

    expect(screen.getByLabelText('Starting session')).toBeInTheDocument()
    expect(stepState('Connecting MCP servers: atlassian')).toBe('active')
    expect(screen.queryByRole('button', { name: /Work locally/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()

    rerender(
      <WorktreeLaunchRow
        sessionId="session-a"
        launch={{ ...local, status: 'complete', stage: 'starting-task' }}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
