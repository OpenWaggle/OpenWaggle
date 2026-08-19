import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('carries a draft review into the session created from it', () => {
    const draftKey = reviewKeyFor(WORKING_PATH, SCOPE)
    useReviewStore.getState().addComment(draftKey, comment('written-before-the-session'))

    const { rerender } = renderHook(
      (scopeKey: string) => useReviewKey({ scopeKey, workingPath: WORKING_PATH, selection: SCOPE }),
      { initialProps: WORKING_PATH },
    )
    rerender('session-a')

    const sessionKey = reviewKeyFor('session-a', SCOPE)
    expect(
      selectReviewThread(useReviewStore.getState(), sessionKey).comments.map((c) => c.id),
    ).toEqual(['written-before-the-session'])
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

    renderHook(() =>
      useReviewKey({ scopeKey: 'session-b', workingPath: WORKING_PATH, selection: SCOPE }),
    )

    // Still the draft's, untouched.
    expect(selectReviewThread(useReviewStore.getState(), draftKey).comments).toHaveLength(1)
    expect(
      selectReviewThread(useReviewStore.getState(), reviewKeyFor('session-b', SCOPE)).comments,
    ).toEqual([])
  })
})
