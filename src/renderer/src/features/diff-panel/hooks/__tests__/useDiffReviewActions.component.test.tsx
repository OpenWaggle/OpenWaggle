import type { GitFileDiff } from '@shared/types/git'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstSendFailed, MessageDeliveredRunFailed } from '@/features/chat/lib'
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
    const { result } = renderHook(() =>
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, () => REVIEW_KEY),
    )

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
    const { result } = renderHook(() =>
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, () => REVIEW_KEY),
    )

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
    const { result } = renderHook(() =>
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, () => REVIEW_KEY),
    )

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

  it('follows the session a failed first send created, keeping the submitted scope', async () => {
    /*
     * Work submitted before a session exists is filed under the working path, and the session created to
     * carry it changes where the panel looks. Inferring the new location from what the panel happened to show
     * when the failure landed got it wrong twice: the scope selection resets for a brand-new session key, so a
     * Branch-scope review resurfaced under the default scope, and in local mode every session of a project
     * shares one working path, so the review could land in a different session's conversation. The session id
     * is carried on the failure instead.
     */
    const draftKey = '/repo::branch'
    const createdSessionKey = 'session-created::branch'
    const otherSessionKey = 'session-other::unstaged'
    const onSendMessage = vi.fn(() =>
      Promise.reject(new FirstSendFailed(new Error('no session worktree'), 'session-created')),
    )

    const { result } = renderHook(() =>
      useDiffReviewActions(onSendMessage, FILES, draftKey, (sessionId) => `${sessionId}::branch`),
    )

    act(() => {
      result.current.onAddToReview(
        { filePath: 'src/app.ts', line: 1, endLine: 1, lineType: 'add' },
        'look here',
      )
    })
    act(() => {
      result.current.onSetSummary('please fix')
    })
    await result.current.onSubmitReview()

    const restored = selectReviewThread(useReviewStore.getState(), createdSessionKey)
    expect(restored.comments.map((comment) => comment.content)).toEqual(['look here'])
    expect(restored.summary).toBe('please fix')
    // Not the session the user may have clicked to in the meantime, and not the draft key.
    expect(selectReviewThread(useReviewStore.getState(), otherSessionKey).comments).toEqual([])
    expect(selectReviewThread(useReviewStore.getState(), draftKey).comments).toEqual([])
  })

  it('leaves the review where it was when the send failed without creating a session', async () => {
    const onSendMessage = vi.fn(() => Promise.reject(new Error('send failed')))
    const { result } = renderHook(() =>
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, () => 'session-x::unstaged'),
    )

    act(() => {
      result.current.onAddToReview(
        { filePath: 'src/app.ts', line: 1, endLine: 1, lineType: 'add' },
        'stay here',
      )
    })
    await result.current.onSubmitReview()

    expect(
      selectReviewThread(useReviewStore.getState(), REVIEW_KEY).comments.map((c) => c.content),
    ).toEqual(['stay here'])
    expect(selectReviewThread(useReviewStore.getState(), 'session-x::unstaged').comments).toEqual(
      [],
    )
  })

  it('keeps a review cleared when the agent received it and only the run failed', async () => {
    /*
     * Sending a message and running the agent turn are one promise to callers, so a provider error or a rate
     * limit rejects it long after the review reached the transcript. Treating that as a failed send restored
     * the agent's own copy as pending - offering it for a second submission - and told the user it could not
     * be sent.
     */
    const onSendMessage = vi.fn(() =>
      Promise.reject(new MessageDeliveredRunFailed(new Error('provider rate limit'))),
    )
    const onReviewSendFailed = vi.fn()
    const { result } = renderHook(() =>
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, () => REVIEW_KEY, onReviewSendFailed),
    )

    act(() => {
      result.current.onAddToReview(
        { filePath: 'src/app.ts', line: 1, endLine: 1, lineType: 'add' },
        'delivered comment',
      )
    })
    await result.current.onSubmitReview()

    expect(selectReviewThread(useReviewStore.getState(), REVIEW_KEY).comments).toEqual([])
    expect(onReviewSendFailed).not.toHaveBeenCalled()
  })
})
