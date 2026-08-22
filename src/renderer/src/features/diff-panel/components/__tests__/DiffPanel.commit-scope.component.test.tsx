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
    stageAllGitChanges: vi.fn(),
    revertAllGitChanges: vi.fn(),
    runStackedGitAction: vi.fn(),
    getLocalVcsStatus: vi.fn(),
    getRemoteVcsStatus: vi.fn(),
    showConfirm: vi.fn(),
  },
}))

const WORKING_PATH = WorkingPath('/repo')

/** The files actually dirty in the working tree. */
const WORKING_TREE_FILE = 'src/dirty-now.ts'
/** A file that only appears in the Branch scope, from an earlier commit. */
const BRANCH_ONLY_FILE = 'src/committed-earlier.ts'

describe('commit scope', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useGitStore.setState({
      statusByWorkingPath: {
        [WORKING_PATH]: {
          status: gitStatus([
            {
              path: WORKING_TREE_FILE,
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
    // Both loaders need a value: an unmocked one returns undefined and the hook awaits it.
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [] })
    /*
     * The panel loads this itself, so it must agree with the seeded store slice: it is the same tree.
     */
    vi.mocked(api.getGitStatus).mockResolvedValue(
      gitStatus([
        {
          path: WORKING_TREE_FILE,
          status: 'modified',
          staged: false,
          unstaged: true,
          additions: 1,
          deletions: 0,
        },
      ]),
    )
    vi.mocked(api.listGitBranches).mockResolvedValue({ currentBranch: 'main', branches: [] })
    /*
     * The quick action needs a real status: without one it renders disabled with a hint, so the
     * commit path would never be exercised.
     */
    vi.mocked(api.getLocalVcsStatus).mockResolvedValue({
      ok: true,
      status: {
        isRepo: true,
        sourceControlProvider: null,
        hasPrimaryRemote: false,
        isDefaultRef: false,
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
    vi.mocked(api.runStackedGitAction).mockResolvedValue({
      ok: true,
      action: 'commit',
      branch: { status: 'unchanged', name: 'main' },
      changeRequest: null,
    })
  })

  it('commits the working tree, not the paths of the scope on display', async () => {
    /*
     * The staged paths used to come from the rendered diff. In Branch scope those are files from
     * earlier commits, so a commit-bearing quick action staged the *current* content of files the
     * user was not looking at and silently omitted the files that were actually dirty. Revert all
     * and Stage all were already scope-gated; commit was not.
     */
    vi.mocked(api.getGitBranchDiff).mockResolvedValue({
      ok: true,
      files: [fileDiff(BRANCH_ONLY_FILE)],
    })
    useDiffScopeStore.setState({
      byThreadKey: { [WORKING_PATH]: { kind: 'branch', baseRef: 'main' } },
    })

    render(
      <DiffPanel
        workingPath={WORKING_PATH}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
      />,
    )

    // The Branch scope is what is loaded and displayed...
    await waitFor(() => expect(api.getGitBranchDiff).toHaveBeenCalledWith(WORKING_PATH, 'main'))
    // The navigator lists the displayed scope's file, so Branch scope really is on screen.
    expect(await screen.findByLabelText('committed-earlier.ts')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /Commit/ }))
    expect(
      await screen.findByText('1 changed file in the working tree will be committed.'),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
      target: { value: 'Ship it' },
    })
    // The dialog's confirm button, not the quick action behind it.
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))

    // ...but the commit uses the dirty working-tree file.
    await waitFor(() => expect(api.runStackedGitAction).toHaveBeenCalled())
    const call = vi.mocked(api.runStackedGitAction).mock.calls.at(0)
    if (!call) throw new Error('expected the stacked action to have been invoked')
    expect(call[1].paths).toEqual([WORKING_TREE_FILE])
  })

  it('loads the working tree itself rather than depending on a pre-populated store', async () => {
    /*
     * Nothing in the diff panel populated the git store: the entry appears as a side effect of the
     * sidebar's per-session indicators, which iterate the session *list*. For a draft session, or
     * before the sidebar caught up, the panel read an empty slice and dispatched a commit with no
     * paths - an enabled button that showed no dialog and failed with a message blaming the user for
     * not selecting files.
     */
    useGitStore.setState({ statusByWorkingPath: {} })
    vi.mocked(api.getGitBranchDiff).mockResolvedValue({ ok: true, files: [] })

    render(
      <DiffPanel
        workingPath={WORKING_PATH}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
      />,
    )

    await waitFor(() => expect(api.getGitStatus).toHaveBeenCalledWith(WORKING_PATH))

    fireEvent.click(await screen.findByRole('button', { name: /Commit/ }))
    expect(
      await screen.findByText('1 changed file in the working tree will be committed.'),
    ).toBeInTheDocument()
  })
})
