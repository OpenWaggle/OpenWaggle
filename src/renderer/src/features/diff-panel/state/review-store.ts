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

interface ReviewState {
  /** Pending comments: saved locally, not yet sent to the agent. */
  comments: ReviewCommentWithSnippet[]
  /** The open comment composer, if any. */
  activeCommentLocation: ReviewCommentLocation | null
  /** Optional overall instruction, attached at submit time. */
  summary: string

  addComment: (comment: ReviewCommentWithSnippet) => void
  removeComment: (id: string) => void
  clearComments: () => void
  setActiveCommentLocation: (location: ReviewCommentLocation | null) => void
  setSummary: (summary: string) => void
  /** Abandon the whole pending review without sending it. */
  discardReview: () => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  comments: [],
  activeCommentLocation: null,
  summary: '',

  addComment(comment: ReviewCommentWithSnippet) {
    set((s) => ({ comments: [...s.comments, comment], activeCommentLocation: null }))
  },

  removeComment(id: string) {
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id) }))
  },

  clearComments() {
    set({ comments: [], activeCommentLocation: null, summary: '' })
  },

  setActiveCommentLocation(location: ReviewCommentLocation | null) {
    set({ activeCommentLocation: location })
  },

  setSummary(summary: string) {
    set({ summary })
  },

  discardReview() {
    set({ comments: [], activeCommentLocation: null, summary: '' })
  },
}))

/** Legacy alias kept so callers that only need the base shape still compile. */
export type { ReviewComment }
