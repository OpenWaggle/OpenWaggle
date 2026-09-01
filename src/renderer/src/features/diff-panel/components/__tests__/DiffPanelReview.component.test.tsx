import { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { reviewKeyFor, selectReviewThread, useReviewStore } from '../../state/review-store'
import { DiffPanel } from '../DiffPanel'
import { FileTree } from '../FileTree'
import { fileDiff, gitStatus } from './diff-panel.test-harness'

/** A minimal pending comment; only its presence matters here. */
function makeReviewComment(id: string) {
  return {
    id,
    filePath: 'src/app.ts',
    startLine: 1,
    endLine: 1,
    content: 'Guard this.',
    createdAt: 0,
    diff: '',
  }
}

/** The panel keys pending reviews by tree and scope; these tests use the default scope. */
const REVIEW_KEY = reviewKeyFor('/repo', { kind: 'unstaged' })

// Async factory + dynamic import: vi.mock is hoisted above imports, so the stub
// cannot be referenced from an ordinary top-level import here.
vi.mock('@pierre/diffs/react', async () => ({
  CodeView: (await import('./diff-panel.test-harness')).StubCodeView,
  WorkerPoolContextProvider: (await import('./diff-panel.test-harness'))
    .StubWorkerPoolContextProvider,
  useWorkerPool: () => undefined,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: vi.fn(),
    getGitBranchDiff: vi.fn(),
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    stageAllGitChanges: vi.fn(),
    revertAllGitChanges: vi.fn(),
    showConfirm: vi.fn(),
  },
}))

describe('Diff panel review flow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listGitBranches).mockResolvedValue({ currentBranch: 'main', branches: [] })
    useGitStore.setState({ statusByWorkingPath: {} })
    useReviewStore.setState({ byReviewKey: {} })
    useUIStore.setState({ toastMessage: null, toastData: null, workspaceTreeOpen: true })
  })

  it('loads project diffs and sends accumulated review comments', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] })
    const onSendMessage = vi.fn()

    render(
      <DiffPanel
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={onSendMessage}
      />,
    )

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
    expect(selectReviewThread(useReviewStore.getState(), REVIEW_KEY).comments).toEqual([])
  })

  it('discards a pending review without sending it', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] })
    const onSendMessage = vi.fn()

    render(
      <DiffPanel
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={onSendMessage}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /select src\/app.ts/ }))
    fireEvent.change(screen.getByPlaceholderText('Leave feedback on this change…'), {
      target: { value: 'needs a test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start a review' }))
    fireEvent.click(screen.getByRole('button', { name: /Discard review/ }))

    expect(selectReviewThread(useReviewStore.getState(), REVIEW_KEY).comments).toEqual([])
    expect(onSendMessage).not.toHaveBeenCalled()
    expect(screen.queryByText(/pending comment/)).not.toBeInTheDocument()
  })

  it('sends a single comment immediately without opening a review', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] })
    const onSendMessage = vi.fn()

    render(
      <DiffPanel
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={onSendMessage}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /select src\/app.ts/ }))
    fireEvent.change(screen.getByPlaceholderText('Leave feedback on this change…'), {
      target: { value: 'rename this' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }))

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce())
    expect(onSendMessage.mock.calls[0]?.[0]).toContain('**Review comment**')
    expect(selectReviewThread(useReviewStore.getState(), REVIEW_KEY).comments).toEqual([])
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

  it('collapses and restores the shared right-side workspace navigator', async () => {
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] })

    render(
      <DiffPanel
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('complementary', { name: 'Workspace navigator' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle workspace navigator' }))
    expect(screen.queryByRole('complementary', { name: 'Workspace navigator' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle workspace navigator' }))
    expect(screen.getByRole('complementary', { name: 'Workspace navigator' })).toBeInTheDocument()
  })
})

describe('pending review isolation', () => {
  it('does not carry pending comments from one session into another', async () => {
    /*
     * The review store was a single flat list with no key, and nothing cleared it on a session
     * change. The panel is not remounted per session, so the Review bar kept showing the previous
     * session's pending comments and submitting posted them into the conversation that happened to
     * be open - with file and line anchors that meant something else there.
     */
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] })
    vi.mocked(api.getGitStatus).mockResolvedValue(gitStatus([]))

    useReviewStore
      .getState()
      .addComment(reviewKeyFor('session-a', { kind: 'unstaged' }), makeReviewComment('from-a'))

    const { rerender } = render(
      <DiffPanel
        sessionId={SessionId('session-a')}
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
      />,
    )

    expect(await screen.findByText('1 pending comment')).toBeInTheDocument()

    rerender(
      <DiffPanel
        sessionId={SessionId('session-b')}
        workingPath={WorkingPath('/repo')}
        repositoryPath={RepositoryPath('/repo')}
        onSendMessage={vi.fn()}
      />,
    )

    // Session B has its own (empty) review, and A's comment is not discarded either.
    await waitFor(() => expect(screen.queryByText('1 pending comment')).not.toBeInTheDocument())
    expect(
      selectReviewThread(useReviewStore.getState(), reviewKeyFor('session-a', { kind: 'unstaged' }))
        .comments,
    ).toHaveLength(1)
  })
})
