import { RepositoryPath, SessionBranchId, SupportedModelId, WorkingPath } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { BranchSummaryCard } from '../BranchSummaryCard'
import { ChatDiffPane } from '../ChatDiffPane'
import { InterruptedRunNotice } from '../InterruptedRunNotice'
import { RunSummary } from '../RunSummary'

vi.mock('@/features/diff-panel/components', () => ({
  DiffPanel: ({ workingPath }: { readonly workingPath: WorkingPath | null }) => (
    <div>Diff for {workingPath ?? 'none'}</div>
  ),
}))

describe('chat auxiliary cards', () => {
  it('renders branch summaries and delegates branch creation', () => {
    const onBranchFromMessage = vi.fn()

    render(
      <BranchSummaryCard
        id="message-1"
        summary="Use a dedicated renderer feature boundary."
        onBranchFromMessage={onBranchFromMessage}
      />,
    )

    fireEvent.click(screen.getByTitle('Branch from summary'))

    expect(screen.getByText('Branch summary')).toBeInTheDocument()
    expect(screen.getByText('Use a dedicated renderer feature boundary.')).toBeInTheDocument()
    expect(onBranchFromMessage).toHaveBeenCalledWith('message-1')
  })

  it('renders run summaries with merged visible phases', () => {
    render(
      <RunSummary
        totalMs={3_000}
        phases={[
          { label: 'Thinking', durationMs: 700 },
          { label: 'Thinking', durationMs: 500 },
          { label: 'Writing', durationMs: 900 },
        ]}
      />,
    )

    expect(screen.getByText('Completed in 3s')).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(screen.getByText('1s')).toBeInTheDocument()
    expect(screen.queryByText('Writing')).not.toBeInTheDocument()
  })

  it('renders interrupted run metadata and delegates dismissal', () => {
    const onDismiss = vi.fn()
    const branchId = SessionBranchId('branch-1')
    const interruptedAt = 1_764_080_000_000

    render(
      <InterruptedRunNotice
        runId="run-1"
        branchId={branchId}
        runMode="waggle"
        model={SupportedModelId('openai/gpt-5.5')}
        interruptedAt={interruptedAt}
        onDismiss={onDismiss}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss interrupted run notice' }))

    expect(screen.getByText('Run interrupted')).toBeInTheDocument()
    expect(screen.getByText('openai/gpt-5.5')).toBeInTheDocument()
    expect(onDismiss).toHaveBeenCalledWith('run-1', branchId)
  })

  it('renders the diff pane wrapper and refresh/close actions', () => {
    useUIStore.setState({ diffRefreshKey: 0 })
    const onClose = vi.fn()
    const onSendMessage = vi.fn()

    render(
      <ChatDiffPane
        section={{
          workingPath: WorkingPath('/repo'),
          repositoryPath: RepositoryPath('/repo'),
          sessionId: null,
          onSendMessage,
        }}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh diff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close diff sidebar' }))

    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('Diff for /repo')).toBeInTheDocument()
    expect(useUIStore.getState().diffRefreshKey).toBe(1)
    expect(onClose).toHaveBeenCalledOnce()
  })

  /**
   * Stage all, Revert all and Commit act on whatever this panel is showing. For a
   * worktree-mode session that is the Session worktree, not the opened checkout, and
   * ADR 0016 requires the panel to say which — a retargeted destructive action must be
   * visible rather than something the user infers.
   */
  it('names the Session worktree when the working path differs from the repository', () => {
    useUIStore.setState({ diffRefreshKey: 0 })

    render(
      <ChatDiffPane
        section={{
          workingPath: WorkingPath('/wt/openwaggle/session-1'),
          repositoryPath: RepositoryPath('/repo/openwaggle'),
          sessionId: null,
          onSendMessage: vi.fn(),
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Worktree · session-1')).toBeInTheDocument()
    expect(screen.queryByText('Opened checkout')).not.toBeInTheDocument()
  })

  it('says the opened checkout when the session runs in the project itself', () => {
    useUIStore.setState({ diffRefreshKey: 0 })

    render(
      <ChatDiffPane
        section={{
          workingPath: WorkingPath('/repo/openwaggle'),
          repositoryPath: RepositoryPath('/repo/openwaggle'),
          sessionId: null,
          onSendMessage: vi.fn(),
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Opened checkout')).toBeInTheDocument()
    expect(screen.queryByText(/^Worktree · /)).not.toBeInTheDocument()
  })
})
