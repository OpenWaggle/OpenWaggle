import type { ReviewComment } from '@shared/types/review'
import { create } from 'zustand'
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload'

export type ReviewCommentLineType = 'add' | 'remove' | 'context'

/** Where a comment is anchored. A range when the user selected several lines. */
export interface ReviewCommentLocation {
  readonly filePath: string
  readonly line: number
  readonly endLine?: number
  readonly lineType: ReviewCommentLineType
}

/** One pending review: the comments, the composer, and the optional summary. */
interface ReviewThread {
  readonly comments: readonly ReviewCommentWithSnippet[]
  readonly activeCommentLocation: ReviewCommentLocation | null
  readonly summary: string
}

const EMPTY_THREAD: ReviewThread = {
  comments: [],
  activeCommentLocation: null,
  summary: '',
}

interface ReviewState {
  /**
   * Pending reviews keyed by the tree and scope they were written against.
   *
   * This was a single flat list. Nothing cleared it on a session, working-path or scope change,
   * so comments written in one session stayed pending while another was open and submitting posted
   * them into that other conversation - with file and line anchors that meant something else
   * there. Keying by review scope isolates them without discarding what the user typed, which
   * clearing on switch would have done. `diff-scope-store` already established this convention.
   */
  byReviewKey: Record<string, ReviewThread>

  addComment: (reviewKey: string, comment: ReviewCommentWithSnippet) => void
  removeComment: (reviewKey: string, id: string) => void
  clearComments: (reviewKey: string) => void
  setActiveCommentLocation: (reviewKey: string, location: ReviewCommentLocation | null) => void
  setSummary: (reviewKey: string, summary: string) => void
  /** Abandon one pending review without sending it. */
  discardReview: (reviewKey: string) => void
  /**
   * Put a review back after a failed send.
   *
   * Submission removes the comments before awaiting, so a rapid double-click cannot send the same
   * review twice. That would otherwise destroy the reviewer's work whenever the send rejects.
   */
  restoreReview: (
    reviewKey: string,
    comments: readonly ReviewCommentWithSnippet[],
    summary: string,
  ) => void
}

function updateThread(
  state: Pick<ReviewState, 'byReviewKey'>,
  reviewKey: string,
  change: (thread: ReviewThread) => ReviewThread,
) {
  const current = state.byReviewKey[reviewKey] ?? EMPTY_THREAD
  return { byReviewKey: { ...state.byReviewKey, [reviewKey]: change(current) } }
}

export const useReviewStore = create<ReviewState>((set) => ({
  byReviewKey: {},

  addComment(reviewKey: string, comment: ReviewCommentWithSnippet) {
    set((state) =>
      updateThread(state, reviewKey, (thread) => ({
        ...thread,
        comments: [...thread.comments, comment],
        activeCommentLocation: null,
      })),
    )
  },

  removeComment(reviewKey: string, id: string) {
    set((state) =>
      updateThread(state, reviewKey, (thread) => ({
        ...thread,
        comments: thread.comments.filter((comment) => comment.id !== id),
      })),
    )
  },

  clearComments(reviewKey: string) {
    set((state) => updateThread(state, reviewKey, () => EMPTY_THREAD))
  },

  setActiveCommentLocation(reviewKey: string, location: ReviewCommentLocation | null) {
    set((state) =>
      updateThread(state, reviewKey, (thread) => ({ ...thread, activeCommentLocation: location })),
    )
  },

  setSummary(reviewKey: string, summary: string) {
    set((state) => updateThread(state, reviewKey, (thread) => ({ ...thread, summary })))
  },

  discardReview(reviewKey: string) {
    set((state) => updateThread(state, reviewKey, () => EMPTY_THREAD))
  },

  restoreReview(reviewKey: string, comments: readonly ReviewCommentWithSnippet[], summary: string) {
    set((state) =>
      updateThread(state, reviewKey, (thread) => ({
        ...thread,
        // Anything written while the send was in flight is kept ahead of the restored comments.
        comments: [...comments, ...thread.comments],
        summary: thread.summary.trim().length > 0 ? thread.summary : summary,
      })),
    )
  },
}))

/**
 * The key a pending review belongs to.
 *
 * Includes the scope: a comment's line anchors and captured snippet only mean anything within the
 * diff they were written against, so a working-tree comment must not reappear on a Branch or Turn
 * diff where those line numbers point somewhere else.
 */
export function reviewKeyFor(threadKey: string | null, scopeKind: string): string {
  return `${threadKey ?? ''}::${scopeKind}`
}

/** Read one pending review, defaulting to empty rather than undefined. */
export function selectReviewThread(
  state: Pick<ReviewState, 'byReviewKey'>,
  reviewKey: string,
): ReviewThread {
  return state.byReviewKey[reviewKey] ?? EMPTY_THREAD
}

/** Legacy alias kept so callers that only need the base shape still compile. */
export type { ReviewComment }
