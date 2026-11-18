import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDiffScopeStore } from '../../state/diff-scope-store'
import { reviewKeyFor, selectReviewThread, useReviewStore } from '../../state/review-store'
import { useReviewKey } from '../useReviewKey'

const SCOPE = { kind: 'unstaged' } as const
const WORKING_PATH = '/repo'

function comment(id: string) {
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

describe('useReviewKey', () => {
  beforeEach(() => {
    useReviewStore.setState({ byReviewKey: {} })
  })

  it('leaves an unsubmitted draft review under the working path when a session appears', () => {
    /*
     * There is deliberately no inferred migration. The key also changes when the user clicks an existing session
     * in the sidebar, and in local mode every session in a project shares one working path - so inferring the
     * move claimed a draft review for another session and merged it into that session's thread, posting one
     * reviewer's comments into a different conversation. A review that matters does move: a failed first send
     * carries the id of the session it created, and the review follows that. An unsubmitted draft simply stays
     * where it was written and reappears whenever the panel is on the draft.
     */
    const draftKey = reviewKeyFor(WORKING_PATH, SCOPE)
    const sessionKey = reviewKeyFor('session-existing', SCOPE)
    useReviewStore.getState().addComment(draftKey, comment('c1'))

    const { rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useReviewKey({ scopeKey, selection: SCOPE }),
      // The panel's scope key IS the working path until a session is selected.
      { initialProps: { scopeKey: WORKING_PATH } },
    )
    rerender({ scopeKey: 'session-existing' })

    expect(selectReviewThread(useReviewStore.getState(), draftKey).comments).toHaveLength(1)
    expect(selectReviewThread(useReviewStore.getState(), sessionKey).comments).toEqual([])
  })

  it('does not claim a draft review for a session that already existed', () => {
    /*
     * In local mode every session in a project shares one working path, so the draft key is shared too.
     * An unconditional migration let whichever already-created session's panel mounted next swallow a
     * draft review and merge it into its own thread - posting one session's comments into another
     * conversation, which is exactly what keying reviews prevents.
     */
    const draftKey = reviewKeyFor(WORKING_PATH, SCOPE)
    useReviewStore.getState().addComment(draftKey, comment('belongs-to-the-draft'))

    renderHook(() => useReviewKey({ scopeKey: 'session-b', selection: SCOPE }))

    // Still the draft's, untouched.
    expect(selectReviewThread(useReviewStore.getState(), draftKey).comments).toHaveLength(1)
    expect(
      selectReviewThread(useReviewStore.getState(), reviewKeyFor('session-b', SCOPE)).comments,
    ).toEqual([])
  })

  it('settles the created session on the scope the review was written in', () => {
    /*
     * The key a review lives under carries its scope, so following a session without also settling that session's
     * scope left a review written in the Branch scope under a key the panel could not show: a new session has no
     * scope of its own and displays the working tree. This is not the inheritance that was removed - it is one
     * concrete event, a send that created this session carrying work written in this scope, writing what it knows.
     */
    const branchScope = { kind: 'branch', baseRef: 'origin/main' } as const
    useDiffScopeStore.setState({ byThreadKey: {} })

    const { result } = renderHook(() =>
      useReviewKey({ scopeKey: WORKING_PATH, selection: branchScope }),
    )
    const followed = result.current.keyForSession('session-created')

    expect(followed).toBe(reviewKeyFor('session-created', branchScope))
    expect(useDiffScopeStore.getState().byThreadKey['session-created']).toEqual(branchScope)
  })
})
