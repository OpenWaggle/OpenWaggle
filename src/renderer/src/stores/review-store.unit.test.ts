import type { ReviewComment } from '@shared/types/review'
import { beforeEach, describe, expect, it } from 'vitest'
import { useReviewStore } from './review-store'

function makeComment(id: string, filePath = 'src/index.ts', line = 10): ReviewComment {
  return {
    id,
    filePath,
    startLine: line,
    endLine: line,
    content: `comment-${id}`,
    createdAt: Date.now(),
  }
}

describe('review-store', () => {
  beforeEach(() => {
    // Reset store state between tests
    useReviewStore.setState({ comments: [], activeCommentLocation: null })
  })

  it('starts with empty comments and null activeCommentLocation', () => {
    const state = useReviewStore.getState()
    expect(state.comments).toEqual([])
    expect(state.activeCommentLocation).toBeNull()
  })

  it('addComment appends a comment to the list', () => {
    const comment = makeComment('c1')
    useReviewStore.getState().addComment(comment)
    expect(useReviewStore.getState().comments).toEqual([comment])
  })

  it('addComment preserves existing comments', () => {
    const c1 = makeComment('c1')
    const c2 = makeComment('c2')
    useReviewStore.getState().addComment(c1)
    useReviewStore.getState().addComment(c2)
    expect(useReviewStore.getState().comments).toHaveLength(2)
    expect(useReviewStore.getState().comments[0].id).toBe('c1')
    expect(useReviewStore.getState().comments[1].id).toBe('c2')
  })

  it('removeComment removes only the targeted comment', () => {
    const c1 = makeComment('c1')
    const c2 = makeComment('c2')
    useReviewStore.getState().addComment(c1)
    useReviewStore.getState().addComment(c2)

    useReviewStore.getState().removeComment('c1')
    const remaining = useReviewStore.getState().comments
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('c2')
  })

  it('clearComments resets comments and activeCommentLocation', () => {
    useReviewStore.getState().addComment(makeComment('c1'))
    useReviewStore.getState().setActiveCommentLocation({ filePath: 'a.ts', line: 5 })

    useReviewStore.getState().clearComments()
    expect(useReviewStore.getState().comments).toEqual([])
    expect(useReviewStore.getState().activeCommentLocation).toBeNull()
  })

  it('setActiveCommentLocation sets and clears location', () => {
    const loc = { filePath: 'lib/utils.ts', line: 42 }
    useReviewStore.getState().setActiveCommentLocation(loc)
    expect(useReviewStore.getState().activeCommentLocation).toEqual(loc)

    useReviewStore.getState().setActiveCommentLocation(null)
    expect(useReviewStore.getState().activeCommentLocation).toBeNull()
  })
})
