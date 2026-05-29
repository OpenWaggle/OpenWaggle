import type { GitFileDiff } from '@shared/types/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/shared/lib/ipc'
import { useReviewStore } from '../../state/review-store'
import { DiffFileSection } from '../DiffFileSection'
import { DiffPanel } from '../DiffPanel'
import { buildDisplayItems } from '../diff-display-items'
import { FileTree } from '../FileTree'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: vi.fn(),
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

describe('Diff panel components', () => {
  beforeEach(() => {
    vi.mocked(api.getGitDiff).mockReset()
    useReviewStore.setState({ comments: [], activeCommentLocation: null })
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
