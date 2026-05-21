import type { ReviewComment } from '@shared/types/review'
import { create } from 'zustand'

export type ReviewCommentLineType = 'add' | 'remove' | 'context'

export interface ReviewCommentLocation {
  readonly filePath: string
  readonly line: number
  readonly lineType: ReviewCommentLineType
}

interface ReviewState {
  comments: ReviewComment[]
  activeCommentLocation: ReviewCommentLocation | null

  addComment: (comment: ReviewComment) => void
  removeComment: (id: string) => void
  clearComments: () => void
  setActiveCommentLocation: (location: ReviewCommentLocation | null) => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  comments: [],
  activeCommentLocation: null,

  addComment(comment: ReviewComment) {
    set((s) => ({ comments: [...s.comments, comment] }))
  },

  removeComment(id: string) {
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id) }))
  },

  clearComments() {
    set({ comments: [], activeCommentLocation: null })
  },

  setActiveCommentLocation(location: ReviewCommentLocation | null) {
    set({ activeCommentLocation: location })
  },
}))
