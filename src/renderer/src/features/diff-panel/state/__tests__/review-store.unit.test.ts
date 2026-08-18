import { beforeEach, describe, expect, it } from 'vitest'
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload'
import {
  type ReviewCommentLocation,
  reviewKeyFor,
  selectReviewThread,
  useReviewStore,
} from '../review-store'

/** Every pending review belongs to a tree and scope; these tests use one key throughout. */
const KEY = reviewKeyFor('thread', 'unstaged')

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
    const sessionA = reviewKeyFor('session-a', 'unstaged')
    const sessionB = reviewKeyFor('session-b', 'unstaged')
    const branchScope = reviewKeyFor('session-a', 'branch')

    useReviewStore.getState().addComment(sessionA, makeComment('a1'))
    useReviewStore.getState().setSummary(sessionA, 'please fix')

    expect(selectReviewThread(useReviewStore.getState(), sessionB).comments).toEqual([])
    expect(selectReviewThread(useReviewStore.getState(), sessionB).summary).toBe('')
    // A different scope of the same session is a different review, too.
    expect(selectReviewThread(useReviewStore.getState(), branchScope).comments).toEqual([])
    expect(selectReviewThread(useReviewStore.getState(), sessionA).comments).toHaveLength(1)
  })

  it('clearing one pending review leaves the others intact', () => {
    const sessionA = reviewKeyFor('session-a', 'unstaged')
    const sessionB = reviewKeyFor('session-b', 'unstaged')
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
})
