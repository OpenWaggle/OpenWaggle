import type { GitFileDiff, GitStatusSummary } from '@shared/types/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { useReviewStore } from '../../state/review-store'
import { DiffPanel } from '../DiffPanel'
import { FileTree } from '../FileTree'

/**
 * CodeView is a measurement-driven renderer (Shiki, virtualization, ResizeObserver)
 * and does not render meaningfully under jsdom. Stub it so these tests exercise OUR
 * wiring -- items, annotations, selection plumbing -- and verify the real renderer
 * in the Electron app instead.
 */
vi.mock('@pierre/diffs/react', () => ({
  CodeView: ({
    items,
    renderAnnotation,
    onSelectedLinesChange,
  }: {
    items: readonly { id: string; fileDiff: { name: string }; annotations?: readonly unknown[] }[]
    renderAnnotation?: (annotation: unknown, item: unknown) => unknown
    onSelectedLinesChange?: (selection: unknown) => void
  }) => (
    <div data-testid="code-view">
      {items.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            onClick={() =>
              onSelectedLinesChange?.({
                id: item.id,
                range: { start: 8, end: 8, side: 'additions' },
              })
            }
          >
            select {item.fileDiff.name}
          </button>
          {(item.annotations ?? []).map((annotation, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stub only
            <div key={index}>{renderAnnotation?.(annotation, item) as never}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: vi.fn(),
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
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

    await screen.findByRole('button', { name: /select src\/app.ts/ })
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

    await screen.findByRole('button', { name: /select src\/app.ts/ })
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

    await screen.findByRole('button', { name: /select src\/app.ts/ })
    fireEvent.click(screen.getByRole('button', { name: 'Revert all' }))

    await screen.findByText('No changes to review')
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

    await screen.findByRole('button', { name: /select src\/app.ts/ })
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

    await screen.findByRole('button', { name: /select src\/app.ts/ })
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

    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledWith('/repo-a'))
    fireEvent.click(screen.getByRole('button', { name: /Stage all/ }))
    rerender(<DiffPanel projectPath="/repo-b" onSendMessage={vi.fn()} />)
    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledWith('/repo-b'))
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

    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledWith('/repo-a'))
    fireEvent.click(screen.getByRole('button', { name: /Stage all/ }))
    rerender(<DiffPanel projectPath="/repo-b" onSendMessage={vi.fn()} />)
    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledWith('/repo-b'))
    rejectStage?.(new Error('obsolete failure'))

    await waitFor(() => expect(api.stageAllGitChanges).toHaveBeenCalledWith('/repo-a'))
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('loads project diffs and sends accumulated review comments', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue([fileDiff()])
    const onSendMessage = vi.fn()

    render(<DiffPanel projectPath="/repo" onSendMessage={onSendMessage} />)

    expect(api.getGitDiff).toHaveBeenCalledWith('/repo')
    expect(await screen.findByRole('button', { name: /select src\/app.ts/ })).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: /select src\/app.ts/ }))
    fireEvent.change(screen.getByPlaceholderText('Leave feedback on this change…'), {
      target: { value: 'Prefer the new branch guard.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start a review' }))

    // The review bar appears only once a review is in progress.
    expect(screen.getByText('1 pending comment')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Submit review/ }))
    fireEvent.change(screen.getByPlaceholderText(/Frame the review for the agent/), {
      target: { value: 'focus on the guard' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send to agent/ }))

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce())
    const sent = onSendMessage.mock.calls[0]?.[0] ?? ''
    expect(sent).toContain('**Code review**')
    expect(sent).toContain('focus on the guard')
    expect(sent).toContain('Prefer the new branch guard.')
    // The structured payload carries the anchored code, not just a line reference.
    expect(sent).toContain('<review_comment')
    expect(sent).toContain('filePath="src/app.ts"')
    expect(useReviewStore.getState().comments).toEqual([])
  })

  it('discards a pending review without sending it', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue([fileDiff()])
    const onSendMessage = vi.fn()

    render(<DiffPanel projectPath="/repo" onSendMessage={onSendMessage} />)

    fireEvent.click(await screen.findByRole('button', { name: /select src\/app.ts/ }))
    fireEvent.change(screen.getByPlaceholderText('Leave feedback on this change…'), {
      target: { value: 'needs a test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start a review' }))
    fireEvent.click(screen.getByRole('button', { name: /Discard review/ }))

    expect(useReviewStore.getState().comments).toEqual([])
    expect(onSendMessage).not.toHaveBeenCalled()
    expect(screen.queryByText(/pending comment/)).not.toBeInTheDocument()
  })

  it('sends a single comment immediately without opening a review', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue([fileDiff()])
    const onSendMessage = vi.fn()

    render(<DiffPanel projectPath="/repo" onSendMessage={onSendMessage} />)

    fireEvent.click(await screen.findByRole('button', { name: /select src\/app.ts/ }))
    fireEvent.change(screen.getByPlaceholderText('Leave feedback on this change…'), {
      target: { value: 'rename this' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }))

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce())
    expect(onSendMessage.mock.calls[0]?.[0]).toContain('**Review comment**')
    expect(useReviewStore.getState().comments).toEqual([])
  })

  it('renders empty and failed diff states without stale files', async () => {
    const { rerender } = render(<DiffPanel projectPath={null} onSendMessage={vi.fn()} />)

    expect(screen.getByText('No changes to review')).toBeInTheDocument()

    vi.mocked(api.getGitDiff).mockRejectedValue(new Error('git unavailable'))
    rerender(<DiffPanel projectPath="/repo" onSendMessage={vi.fn()} />)

    expect(await screen.findByText('No changes to review')).toBeInTheDocument()
  })

  it('renders the changed-file navigator with status and line counts', () => {
    const onFileClick = vi.fn()

    render(
      <FileTree
        files={[fileDiff('src/app.ts'), fileDiff('src/components/Button.tsx')]}
        onFileClick={onFileClick}
      />,
    )

    // Directory grouping collapses and expands.
    fireEvent.click(screen.getByText('src'))
    expect(screen.queryByText('app.ts')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('src'))
    fireEvent.click(screen.getByText('app.ts'))
    expect(onFileClick).toHaveBeenCalledWith('src/app.ts')

    // Issue #30: per-file status glyph and change counts.
    expect(screen.getAllByRole('img', { name: 'modified' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('+1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0)
  })
})
