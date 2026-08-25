import { RepositoryPath, WorkingPath } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { useDiffScopeStore } from '../../state/diff-scope-store'
import { useReviewStore } from '../../state/review-store'
import { DiffPanel } from '../DiffPanel'
import { fileDiff, gitStatus } from './diff-panel.test-harness'

vi.mock('@pierre/diffs/react', async () => ({
  CodeView: (await import('./diff-panel.test-harness')).StubCodeView,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: vi.fn(),
    getGitBranchDiff: vi.fn(),
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    listTurnCheckpoints: vi.fn(),
    stageAllGitChanges: vi.fn(),
    revertAllGitChanges: vi.fn(),
    runStackedGitAction: vi.fn(),
    getLocalVcsStatus: vi.fn(),
    getRemoteVcsStatus: vi.fn(),
    showConfirm: vi.fn(),
  },
}))

const WORKING_PATH = WorkingPath('/repo')

function renderPanel(refreshToken: number) {
  return render(
    <DiffPanel
      workingPath={WORKING_PATH}
      repositoryPath={RepositoryPath('/repo')}
      onSendMessage={vi.fn()}
      refreshToken={refreshToken}
    />,
  )
}

describe('diff refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useGitStore.setState({
      statusByWorkingPath: {
        [WORKING_PATH]: {
          status: gitStatus([
            {
              path: 'src/app.ts',
              status: 'modified',
              staged: false,
              unstaged: true,
              additions: 1,
              deletions: 0,
            },
          ]),
          isLoading: false,
          error: null,
        },
      },
    })
    useDiffScopeStore.setState({ byThreadKey: {} })
    useReviewStore.setState({ byReviewKey: {} })
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] })
    // The panel loads this itself; it must match the seeded store slice - the same working tree.
    vi.mocked(api.getGitStatus).mockResolvedValue(
      gitStatus([
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: false,
          unstaged: true,
          additions: 1,
          deletions: 0,
        },
      ]),
    )
    vi.mocked(api.listGitBranches).mockResolvedValue({ currentBranch: 'main', branches: [] })
    vi.mocked(api.listTurnCheckpoints).mockResolvedValue([])
    vi.mocked(api.getLocalVcsStatus).mockResolvedValue({
      ok: true,
      status: {
        isRepo: true,
        sourceControlProvider: null,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        pushTargetRef: 'feature/x',
        pushTargetIsDefaultRef: false,
        refName: 'feature/x',
        hasWorkingTreeChanges: true,
        workingTree: { files: [], insertions: 0, deletions: 0 },
      },
    })
    vi.mocked(api.getRemoteVcsStatus).mockResolvedValue({
      ok: false,
      code: 'not-a-repo',
      message: 'n/a',
    })
  })

  it('refetches the diff when the refresh token changes', async () => {
    const { rerender } = renderPanel(1)
    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledTimes(1))

    rerender(
      <DiffPanel
        workingPath={WORKING_PATH}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
        refreshToken={2}
      />,
    )

    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledTimes(2))
  })

  it('keeps a commit message being typed when a refresh arrives', async () => {
    /*
     * Refresh was implemented by remounting the panel with `key=`, and it fires on every turn end,
     * every working-tree broadcast and every window focus. Typing a commit message while the
     * agent's turn ended therefore made the dialog - and the message - vanish.
     */
    const { rerender } = renderPanel(1)

    fireEvent.click(await screen.findByRole('button', { name: /Commit/ }))
    const messageBox = within(screen.getByRole('dialog')).getByRole('textbox', {
      name: 'Commit message',
    })
    fireEvent.change(messageBox, { target: { value: 'half-written message' } })

    rerender(
      <DiffPanel
        workingPath={WORKING_PATH}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
        refreshToken={2}
      />,
    )

    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledTimes(2))
    expect(
      within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Commit message' }),
    ).toHaveValue('half-written message')
  })
})
