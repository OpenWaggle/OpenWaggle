import type { GitFileDiff } from '@shared/types/git'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reviewKeyFor,
  selectReviewThread,
  useReviewStore,
} from '@/features/diff-panel/state/review-store'
import { useDiffReviewActions } from '../useDiffReviewActions'

/** The panel keys pending reviews by tree and scope; these tests use the default scope. */
const REVIEW_KEY = reviewKeyFor('/repo', { kind: 'unstaged' })

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
    const { result } = renderHook(() => useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY))

    act(() => {
      result.current.onAddToReview(
        { filePath: 'src/app.ts', line: 1, endLine: 1, lineType: 'add' },
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
    expect(selectReviewThread(useReviewStore.getState(), REVIEW_KEY).comments).toEqual([])
  })

  it('keeps the pending review when the send fails', async () => {
    /*
     * The comments were cleared before the send was known to have worked, and the panel adapted an
     * async send as fire-and-forget so a rejection was unobservable. Main throws outright for a
     * missing session worktree, so a whole review the reviewer had written was destroyed with no way
     * to recover it.
     */
    const onSendMessage = vi.fn(async () => {
      throw new Error('worktree is gone')
    })
    const { result } = renderHook(() => useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY))

    act(() => {
      result.current.onAddToReview(
        { filePath: 'src/app.ts', line: 1, endLine: 1, lineType: 'add' },
        'Guard this.',
      )
    })
    await act(async () => {
      await result.current.onSubmitReview()
    })

    expect(onSendMessage).toHaveBeenCalledTimes(1)
    expect(selectReviewThread(useReviewStore.getState(), REVIEW_KEY).comments).toHaveLength(1)
  })

  it('clears the pending review once the send succeeds', async () => {
    const onSendMessage = vi.fn(async () => {})
    const { result } = renderHook(() => useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY))

    act(() => {
      result.current.onAddToReview(
        { filePath: 'src/app.ts', line: 1, endLine: 1, lineType: 'add' },
        'Guard this.',
      )
    })
    await act(async () => {
      await result.current.onSubmitReview()
    })

    expect(selectReviewThread(useReviewStore.getState(), REVIEW_KEY).comments).toEqual([])
  })
})
