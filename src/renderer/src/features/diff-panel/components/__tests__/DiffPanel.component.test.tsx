import type { GitFileDiff, GitStatusSummary } from '@shared/types/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { useReviewStore } from '../../state/review-store'
import { DiffFileSection } from '../DiffFileSection'
import { DiffPanel } from '../DiffPanel'
import { buildDisplayItems } from '../diff-display-items'
import { FileTree } from '../FileTree'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: vi.fn(),
    getGitStatus: vi.fn(),
    stageAllGitChanges: vi.fn(),
    revertAllGitChanges: vi.fn(),
    showConfirm: vi.fn(),
  },
}))

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,9 +1,9 @@
 const one = 1
 const two = 2
 const three = 3
 const four = 4
 const five = 5
 const six = 6
 const seven = 7
-old line
+new line`

function fileDiff(path = 'src/app.ts') {
  return {
    path,
    diff: SAMPLE_DIFF,
    additions: 1,
    deletions: 1,
  } satisfies GitFileDiff
}

function gitStatus(changedFiles: GitStatusSummary['changedFiles']): GitStatusSummary {
  return {
    branch: 'main',
    additions: 1,
    deletions: 1,
    filesChanged: changedFiles.length,
    changedFiles,
    clean: changedFiles.length === 0,
    ahead: 0,
    behind: 0,
  }
}

describe('Diff panel components', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useGitStore.setState({ status: null, statusError: null, isLoading: false })
    useReviewStore.setState({ comments: [], activeCommentLocation: null })
    useUIStore.setState({ toastMessage: null, toastData: null })
  })

  it('stages every change and refreshes the diff and Git status', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue([fileDiff()])
    vi.mocked(api.getGitStatus).mockResolvedValue(
      gitStatus([
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: true,
          unstaged: false,
          additions: 1,
          deletions: 1,
        },
      ]),
    )
    vi.mocked(api.stageAllGitChanges).mockResolvedValue({
      ok: true,
      message: 'All working-tree changes staged.',
    })

    render(<DiffPanel projectPath="/repo" onSendMessage={vi.fn()} />)

    await screen.findByText('src/app.ts')
    fireEvent.click(screen.getByRole('button', { name: /Stage all/ }))

    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledTimes(2))
    expect(api.stageAllGitChanges).toHaveBeenCalledWith('/repo')
    expect(api.getGitStatus).toHaveBeenCalledWith('/repo')
    expect(screen.getByRole('button', { name: /Stage all/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Revert all' })).toBeEnabled()
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'All working-tree changes staged.',
      variant: 'success',
    })
  })

  it('keeps every change when main-process revert confirmation is cancelled', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue([fileDiff()])
    vi.mocked(api.revertAllGitChanges).mockResolvedValue({
      ok: false,
      code: 'cancelled',
      message: 'Revert all cancelled.',
    })

    render(<DiffPanel projectPath="/repo" onSendMessage={vi.fn()} />)

    await screen.findByText('src/app.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Revert all' }))

    await waitFor(() => expect(api.revertAllGitChanges).toHaveBeenCalledWith('/repo'))
    expect(api.getGitDiff).toHaveBeenCalledOnce()
    expect(api.getGitStatus).not.toHaveBeenCalled()
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('reverts confirmed changes and refreshes the diff and Git status', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValueOnce([fileDiff()]).mockResolvedValueOnce([])
    vi.mocked(api.getGitStatus).mockResolvedValue(gitStatus([]))
    vi.mocked(api.revertAllGitChanges).mockResolvedValue({
      ok: true,
      message: 'All eligible working-tree changes reverted.',
    })

    render(<DiffPanel projectPath="/repo" onSendMessage={vi.fn()} />)

    await screen.findByText('src/app.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Revert all' }))

    await screen.findByText('No uncommitted changes')
    expect(api.revertAllGitChanges).toHaveBeenCalledWith('/repo')
    expect(api.getGitDiff).toHaveBeenCalledTimes(2)
    expect(api.getGitStatus).toHaveBeenCalledWith('/repo')
    expect(screen.getByRole('button', { name: 'Revert all' })).toBeDisabled()
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'All eligible working-tree changes reverted.',
      variant: 'success',
    })
  })

  it('surfaces a stage failure and still refreshes potentially changed Git state', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue([fileDiff()])
    vi.mocked(api.getGitStatus).mockResolvedValue(
      gitStatus([
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: false,
          unstaged: true,
          additions: 1,
          deletions: 1,
        },
      ]),
    )
    vi.mocked(api.stageAllGitChanges).mockResolvedValue({
      ok: false,
      code: 'unknown',
      message: 'Git index is locked.',
    })

    render(<DiffPanel projectPath="/repo" onSendMessage={vi.fn()} />)

    await screen.findByText('src/app.ts')
    fireEvent.click(screen.getByRole('button', { name: /Stage all/ }))

    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledTimes(2))
    expect(api.getGitStatus).toHaveBeenCalledWith('/repo')
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'Git index is locked.',
      variant: 'error',
    })
  })

  it('keeps Stage all enabled for files with staged and unstaged changes', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue([fileDiff()])
    useGitStore.setState({
      statusProjectPath: '/repo',
      status: gitStatus([
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: true,
          unstaged: true,
          additions: 1,
          deletions: 1,
        },
      ]),
    })
    vi.mocked(api.stageAllGitChanges).mockResolvedValue({
      ok: true,
      message: 'All working-tree changes staged.',
    })

    render(<DiffPanel projectPath="/repo" onSendMessage={vi.fn()} />)

    await screen.findByText('src/app.ts')
    expect(screen.getByRole('button', { name: /Stage all/ })).toBeEnabled()
  })

  it('does not refresh or toast an action result after switching projects', async () => {
    let resolveStage: ((result: { ok: true; message: string }) => void) | undefined
    vi.mocked(api.getGitDiff).mockImplementation(async (projectPath) => [fileDiff(projectPath)])
    vi.mocked(api.stageAllGitChanges).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStage = resolve
        }),
    )

    const { rerender } = render(<DiffPanel projectPath="/repo-a" onSendMessage={vi.fn()} />)

    await screen.findByText('/repo-a')
    fireEvent.click(screen.getByRole('button', { name: /Stage all/ }))
    rerender(<DiffPanel projectPath="/repo-b" onSendMessage={vi.fn()} />)
    await screen.findByText('/repo-b')
    resolveStage?.({ ok: true, message: 'All working-tree changes staged.' })

    await waitFor(() => expect(api.stageAllGitChanges).toHaveBeenCalledWith('/repo-a'))
    expect(api.getGitDiff).toHaveBeenCalledTimes(2)
    expect(api.getGitStatus).not.toHaveBeenCalled()
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('does not toast an action rejection after switching projects', async () => {
    let rejectStage: ((error: Error) => void) | undefined
    vi.mocked(api.getGitDiff).mockImplementation(async (projectPath) => [fileDiff(projectPath)])
    vi.mocked(api.stageAllGitChanges).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStage = reject
        }),
    )

    const { rerender } = render(<DiffPanel projectPath="/repo-a" onSendMessage={vi.fn()} />)

    await screen.findByText('/repo-a')
    fireEvent.click(screen.getByRole('button', { name: /Stage all/ }))
    rerender(<DiffPanel projectPath="/repo-b" onSendMessage={vi.fn()} />)
    await screen.findByText('/repo-b')
    rejectStage?.(new Error('obsolete failure'))

    await waitFor(() => expect(api.stageAllGitChanges).toHaveBeenCalledWith('/repo-a'))
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('loads project diffs and sends accumulated review comments', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue([fileDiff()])
    const onSendMessage = vi.fn()

    render(<DiffPanel projectPath="/repo" onSendMessage={onSendMessage} />)

    expect(api.getGitDiff).toHaveBeenCalledWith('/repo')
    expect(await screen.findByText('src/app.ts')).toBeInTheDocument()

    fireEvent.click(screen.getByText('new line'))
    fireEvent.change(screen.getByPlaceholderText('Leave feedback on this change…'), {
      target: { value: 'Prefer the new branch guard.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add to review' }))
    fireEvent.click(screen.getByRole('button', { name: /Send review/ }))

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce())
    expect(onSendMessage.mock.calls[0]?.[0]).toContain('Prefer the new branch guard.')
    expect(useReviewStore.getState().comments).toEqual([])
  })

  it('renders empty and failed diff states without stale files', async () => {
    const { rerender } = render(<DiffPanel projectPath={null} onSendMessage={vi.fn()} />)

    expect(screen.getByText('No uncommitted changes')).toBeInTheDocument()

    vi.mocked(api.getGitDiff).mockRejectedValue(new Error('git unavailable'))
    rerender(<DiffPanel projectPath="/repo" onSendMessage={vi.fn()} />)

    expect(await screen.findByText('No uncommitted changes')).toBeInTheDocument()
  })

  it('expands collapsed context and emits single-line comments', () => {
    const onSetActiveComment = vi.fn()
    const onAddSingleComment = vi.fn()

    render(
      <DiffFileSection
        filePath="src/app.ts"
        items={buildDisplayItems(SAMPLE_DIFF)}
        additions={1}
        deletions={1}
        activeCommentLocation={{ filePath: 'src/app.ts', line: 8, lineType: 'add' }}
        onSetActiveComment={onSetActiveComment}
        onAddSingleComment={onAddSingleComment}
        onAddToReview={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('1 unmodified line'))
    expect(screen.getByText('const four = 4')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Leave feedback on this change…'), {
      target: { value: 'ship it' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add single comment' }))

    expect(onAddSingleComment).toHaveBeenCalledWith('src/app.ts', 8, 8, 'ship it')
  })

  it('renders nested file tree controls and bottom action state', () => {
    const onFileClick = vi.fn()
    const onSendReview = vi.fn()

    render(
      <FileTree
        files={[fileDiff('src/app.ts'), fileDiff('src/components/Button.tsx')]}
        reviewCount={2}
        onFileClick={onFileClick}
        onSendReview={onSendReview}
      />,
    )

    fireEvent.click(screen.getByText('src'))
    expect(screen.queryByText('app.ts')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('src'))
    fireEvent.click(screen.getByText('app.ts'))
    fireEvent.click(screen.getByRole('button', { name: /Send review/ }))

    expect(onFileClick).toHaveBeenCalledWith('src/app.ts')
    expect(onSendReview).toHaveBeenCalledOnce()
  })
})
