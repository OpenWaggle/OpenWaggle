import type { ReviewComment } from '@shared/types/review'
import { create } from 'zustand'

interface ReviewState {
  comments: ReviewComment[]
  activeCommentLocation: { filePath: string; line: number } | null

  addComment: (comment: ReviewComment) => void
  removeComment: (id: string) => void
  clearComments: () => void
  setActiveCommentLocation: (location: { filePath: string; line: number } | null) => void
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

  setActiveCommentLocation(location: { filePath: string; line: number } | null) {
    set({ activeCommentLocation: location })
  },
}))
