import type { GitFileDiff } from '@shared/types/git'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReviewStore } from '@/features/diff-panel/state/review-store'
import { useDiffReviewActions } from '../useDiffReviewActions'

const FILES: readonly GitFileDiff[] = [
  {
    path: 'src/app.ts',
    diff: '@@ -1,2 +1,2 @@\n-const a = 1\n+const a = 2\n',
    additions: 1,
    deletions: 1,
  },
]

describe('useDiffReviewActions', () => {
  beforeEach(() => {
    useReviewStore.setState(useReviewStore.getInitialState())
  })

  /**
   * The real double-submit race, which a component test cannot reproduce: React
   * Testing Library flushes a re-render between two fireEvent clicks, so the second
   * click already sees the cleared array. Calling the SAME captured handler twice
   * within one act() is what actually happens on a fast double-click or a key repeat
   * — the closure never refreshes in between.
   */
  it('submits once when the same handler instance is invoked twice without a re-render', () => {
    const onSendMessage = vi.fn()
    const { result } = renderHook(() => useDiffReviewActions(onSendMessage, FILES))

    act(() => {
      result.current.onAddToReview(
        { filePath: 'src/app.ts', startLine: 1, endLine: 1, lineType: 'add' },
        'Guard this.',
      )
    })
    expect(result.current.comments).toHaveLength(1)

    const submit = result.current.onSubmitReview
    act(() => {
      submit()
      submit()
    })

    expect(onSendMessage).toHaveBeenCalledTimes(1)
    expect(useReviewStore.getState().comments).toEqual([])
  })
})
