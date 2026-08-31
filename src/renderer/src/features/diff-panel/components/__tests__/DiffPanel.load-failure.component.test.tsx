import { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { useReviewStore } from '../../state/review-store'
import { DiffPanel } from '../DiffPanel'

vi.mock('@pierre/diffs/react', async () => ({
  CodeView: (await import('./diff-panel.test-harness')).StubCodeView,
  WorkerPoolContextProvider: (await import('./diff-panel.test-harness'))
    .StubWorkerPoolContextProvider,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: vi.fn(),
    getGitBranchDiff: vi.fn(),
    listTurnCheckpoints: vi.fn(),
    getTurnDiff: vi.fn(),
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    stageAllGitChanges: vi.fn(),
    revertAllGitChanges: vi.fn(),
    showConfirm: vi.fn(),
  },
}))

describe('diff load failures', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listGitBranches).mockResolvedValue({ currentBranch: 'main', branches: [] })
    useGitStore.setState({ statusByWorkingPath: {} })
    useReviewStore.setState({ byReviewKey: {} })
  })

  it('distinguishes an empty diff from a diff that could not be loaded', async () => {
    /*
     * A failed load used to render "No changes to review", so not-a-repository, an unresolvable
     * base ref, a vanished worktree and a transport failure all told the user their work was
     * committed when the panel could not read the tree. This assertion replaces one that pinned
     * that behaviour.
     */
    const { rerender } = render(
      <DiffPanel workingPath={null} repositoryPath={null} onSendMessage={vi.fn()} />,
    )

    expect(screen.getByText('No changes to review')).toBeInTheDocument()

    vi.mocked(api.getGitDiff).mockRejectedValue(new Error('git unavailable'))
    rerender(
      <DiffPanel
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this diff')
    expect(screen.queryByText('No changes to review')).not.toBeInTheDocument()
  })

  it('offers a retry that reloads the diff after a failure', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue({
      ok: false,
      code: 'not-git-repo',
      message: 'Selected folder is not a Git repository.',
    })
    render(
      <DiffPanel
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
      />,
    )

    expect(await screen.findByText('Selected folder is not a Git repository.')).toBeInTheDocument()

    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('No changes to review')).toBeInTheDocument()
  })

  it('says a turn checkpoint is gone rather than reporting the turn as unchanged', async () => {
    /*
     * A turn diff that is missing - pruned by retention - or unreadable produced an empty file list,
     * which rendered as "No changes to review": the user was told a past turn changed nothing.
     */
    const { useDiffScopeStore } = await import('../../state/diff-scope-store')
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [] })
    vi.mocked(api.getGitStatus).mockResolvedValue({
      branch: 'main',
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      changedFiles: [],
      clean: true,
      ahead: 0,
      behind: 0,
    })
    vi.mocked(api.listTurnCheckpoints).mockResolvedValue([])
    // The checkpoint no longer exists.
    vi.mocked(api.getTurnDiff).mockResolvedValue(null)
    useDiffScopeStore.setState({
      // The panel keys its scope by session id when it has one.
      byThreadKey: {
        'session-a': { kind: 'turn', turnId: 'turn-1', filePath: null, revealRequestId: 0 },
      },
    })

    render(
      <DiffPanel
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        sessionId={SessionId('session-a')}
        onSendMessage={vi.fn()}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this diff')
    expect(screen.queryByText('No changes to review')).not.toBeInTheDocument()
    /*
     * And no working-tree diff was requested: a turn's diff comes from the checkpoint store, so
     * shelling out to `git diff` on every refresh only produced a result the panel discarded.
     */
    expect(api.getGitDiff).not.toHaveBeenCalled()
    expect(api.getGitBranchDiff).not.toHaveBeenCalled()
  })
})
