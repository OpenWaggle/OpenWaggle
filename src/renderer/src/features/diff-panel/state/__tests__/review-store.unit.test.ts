import { beforeEach, describe, expect, it } from 'vitest'
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload'
import {
  type ReviewCommentLocation,
  reviewKeyFor,
  selectReviewThread,
  useReviewStore,
} from '../review-store'

/** Every pending review belongs to a tree and scope; these tests use one key throughout. */
const KEY = reviewKeyFor('thread', { kind: 'unstaged' })

function makeComment(id: string, filePath = 'src/index.ts', line = 10): ReviewCommentWithSnippet {
  return {
    id,
    filePath,
    startLine: line,
    endLine: line,
    content: `comment-${id}`,
    createdAt: Date.now(),
    diff: '',
  }
}

describe('review-store', () => {
  beforeEach(() => {
    // Reset store state between tests
    useReviewStore.setState({ byReviewKey: {} })
  })

  it('starts with empty comments and null activeCommentLocation', () => {
    const thread = selectReviewThread(useReviewStore.getState(), KEY)
    expect(thread.comments).toEqual([])
    expect(thread.activeCommentLocation).toBeNull()
  })

  it('keeps pending reviews of different trees and scopes apart', () => {
    /*
     * The store used to be one flat list with no key. Nothing cleared it on a session,
     * working-path or scope change, so comments written in one session stayed pending while
     * another was open and submitting posted them into that other conversation - anchored to file
     * and line numbers that meant something else there.
     */
    const sessionA = reviewKeyFor('session-a', { kind: 'unstaged' })
    const sessionB = reviewKeyFor('session-b', { kind: 'unstaged' })
    const branchScope = reviewKeyFor('session-a', { kind: 'branch', baseRef: null })

    useReviewStore.getState().addComment(sessionA, makeComment('a1'))
    useReviewStore.getState().setSummary(sessionA, 'please fix')

    expect(selectReviewThread(useReviewStore.getState(), sessionB).comments).toEqual([])
    expect(selectReviewThread(useReviewStore.getState(), sessionB).summary).toBe('')
    // A different scope of the same session is a different review, too.
    expect(selectReviewThread(useReviewStore.getState(), branchScope).comments).toEqual([])
    expect(selectReviewThread(useReviewStore.getState(), sessionA).comments).toHaveLength(1)
  })

  it('clearing one pending review leaves the others intact', () => {
    const sessionA = reviewKeyFor('session-a', { kind: 'unstaged' })
    const sessionB = reviewKeyFor('session-b', { kind: 'unstaged' })
    useReviewStore.getState().addComment(sessionA, makeComment('a1'))
    useReviewStore.getState().addComment(sessionB, makeComment('b1'))

    useReviewStore.getState().clearComments(sessionA)

    expect(selectReviewThread(useReviewStore.getState(), sessionA).comments).toEqual([])
    expect(selectReviewThread(useReviewStore.getState(), sessionB).comments).toHaveLength(1)
  })

  it('addComment appends a comment to the list', () => {
    const comment = makeComment('c1')
    useReviewStore.getState().addComment(KEY, comment)
    expect(selectReviewThread(useReviewStore.getState(), KEY).comments).toEqual([comment])
  })

  it('addComment preserves existing comments', () => {
    const c1 = makeComment('c1')
    const c2 = makeComment('c2')
    useReviewStore.getState().addComment(KEY, c1)
    useReviewStore.getState().addComment(KEY, c2)
    expect(selectReviewThread(useReviewStore.getState(), KEY).comments).toHaveLength(2)
    expect(selectReviewThread(useReviewStore.getState(), KEY).comments[0].id).toBe('c1')
    expect(selectReviewThread(useReviewStore.getState(), KEY).comments[1].id).toBe('c2')
  })

  it('removeComment removes only the targeted comment', () => {
    const c1 = makeComment('c1')
    const c2 = makeComment('c2')
    useReviewStore.getState().addComment(KEY, c1)
    useReviewStore.getState().addComment(KEY, c2)

    useReviewStore.getState().removeComment(KEY, 'c1')
    const remaining = selectReviewThread(useReviewStore.getState(), KEY).comments
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('c2')
  })

  it('clearComments resets comments and activeCommentLocation', () => {
    useReviewStore.getState().addComment(KEY, makeComment('c1'))
    useReviewStore
      .getState()
      .setActiveCommentLocation(KEY, { filePath: 'a.ts', line: 5, lineType: 'add' })

    useReviewStore.getState().clearComments(KEY)
    expect(selectReviewThread(useReviewStore.getState(), KEY).comments).toEqual([])
    expect(selectReviewThread(useReviewStore.getState(), KEY).activeCommentLocation).toBeNull()
  })

  it('setActiveCommentLocation sets and clears location', () => {
    const loc = {
      filePath: 'lib/utils.ts',
      line: 42,
      lineType: 'context',
    } satisfies ReviewCommentLocation
    useReviewStore.getState().setActiveCommentLocation(KEY, loc)
    expect(selectReviewThread(useReviewStore.getState(), KEY).activeCommentLocation).toEqual(loc)

    useReviewStore.getState().setActiveCommentLocation(KEY, null)
    expect(selectReviewThread(useReviewStore.getState(), KEY).activeCommentLocation).toBeNull()
  })

  it('keeps reviews of different turns and different base refs apart', () => {
    /*
     * The key used to carry only the scope *kind*, so every turn shared one review and every base
     * ref shared another. Turn 7's diff is not turn 2's, and `main...HEAD` is not `develop...HEAD`:
     * a review written against one reappeared on the other with line anchors pointing at unrelated
     * code, which is precisely what keying by scope was meant to prevent.
     */
    const turnScope = (turnId: string) =>
      ({ kind: 'turn', turnId, filePath: null, revealRequestId: 0 }) as const
    const turnSeven = reviewKeyFor('s', turnScope('turn-7'))
    const turnTwo = reviewKeyFor('s', turnScope('turn-2'))
    const againstMain = reviewKeyFor('s', { kind: 'branch', baseRef: 'main' })
    const againstDevelop = reviewKeyFor('s', { kind: 'branch', baseRef: 'develop' })

    expect(turnSeven).not.toBe(turnTwo)
    expect(againstMain).not.toBe(againstDevelop)

    useReviewStore.getState().addComment(turnSeven, makeComment('on-turn-7'))
    expect(selectReviewThread(useReviewStore.getState(), turnTwo).comments).toEqual([])
    expect(selectReviewThread(useReviewStore.getState(), turnSeven).comments).toHaveLength(1)
  })

  it('does not retain reviews that hold nothing', () => {
    /*
     * Every key the panel touched was kept for the life of the process - one per session and scope
     * ever opened, including sessions since deleted. An empty review carries no user work.
     */
    const key = reviewKeyFor('s', { kind: 'unstaged' })
    useReviewStore.getState().addComment(key, makeComment('c1'))
    expect(Object.keys(useReviewStore.getState().byReviewKey)).toEqual([key])

    useReviewStore.getState().removeComment(key, 'c1')

    expect(Object.keys(useReviewStore.getState().byReviewKey)).toEqual([])
  })

  it('keeps a review that holds only a summary', () => {
    // A summary is user work too, even before any comment exists.
    const key = reviewKeyFor('s', { kind: 'unstaged' })
    useReviewStore.getState().setSummary(key, 'please fix the naming')

    expect(Object.keys(useReviewStore.getState().byReviewKey)).toEqual([key])
  })
})
