import type { GitFileDiff } from '@shared/types/git'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageDeliveredRunFailed } from '@/features/chat/lib'
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
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, REVIEW_KEY),
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
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, REVIEW_KEY),
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
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, REVIEW_KEY),
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

  it('follows the panel when the review key changes while the send is in flight', async () => {
    /*
     * The first send of a session changes the key mid-flight: creating a session sets the active id
     * synchronously, so the panel moves from the working path to the session id before the send can reject.
     * Restoring under the key captured at click time wrote the review where nothing was reading, and the
     * one-shot key migration had already fired against the emptied draft - so a failed first send lost
     * everything the reviewer had written.
     */
    const draftKey = '/repo::unstaged'
    const sessionKey = 'session-1::unstaged'
    let rejectSend: ((error: Error) => void) | null = null
    const onSendMessage = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject
        }),
    )

    const { result, rerender } = renderHook(
      // The draft key is what this panel would use with no session yet, and it does not move here: the same
      // working tree and scope simply gain a session id. That is the one transition the restore may follow.
      ({ key }: { key: string }) => useDiffReviewActions(onSendMessage, FILES, key, draftKey),
      { initialProps: { key: draftKey } },
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

    const submitted = result.current.onSubmitReview()
    // The panel moves to the session key while the send is still in flight.
    rerender({ key: sessionKey })
    act(() => {
      rejectSend?.(new Error('no session worktree'))
    })
    await submitted

    const restored = selectReviewThread(useReviewStore.getState(), sessionKey)
    expect(restored.comments.map((comment) => comment.content)).toEqual(['look here'])
    expect(restored.summary).toBe('please fix')
  })

  it('does not follow a scope switch, which would move the review into another diff', async () => {
    /*
     * "The key changed" is not on its own a reason to follow. It also changes for a scope tab, a base ref, a
     * turn, a session switch and a project switch, and following those *moves* the thread: comments and line
     * anchors taken from one diff would sit pending in another, or one session's review in another session's
     * conversation - which is what keying reviews was introduced to prevent.
     */
    const unstagedKey = '/repo::unstaged'
    const stagedKey = '/repo::staged'
    let rejectSend: ((error: Error) => void) | null = null
    const onSendMessage = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject
        }),
    )

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useDiffReviewActions(onSendMessage, FILES, key, key),
      { initialProps: { key: unstagedKey } },
    )

    act(() => {
      result.current.onAddToReview(
        { filePath: 'src/app.ts', line: 1, endLine: 1, lineType: 'add' },
        'scoped comment',
      )
    })

    const submitted = result.current.onSubmitReview()
    // The user clicks the other scope tab while the send is in flight.
    rerender({ key: stagedKey })
    act(() => {
      rejectSend?.(new Error('send failed'))
    })
    await submitted

    expect(
      selectReviewThread(useReviewStore.getState(), unstagedKey).comments.map((c) => c.content),
    ).toEqual(['scoped comment'])
    expect(selectReviewThread(useReviewStore.getState(), stagedKey).comments).toEqual([])
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
      useDiffReviewActions(onSendMessage, FILES, REVIEW_KEY, REVIEW_KEY, onReviewSendFailed),
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
