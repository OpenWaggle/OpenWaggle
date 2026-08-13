import { create } from 'zustand';
export const useReviewStore = create((set) => ({
    comments: [],
    activeCommentLocation: null,
    summary: '',
    addComment(comment) {
        set((s) => ({ comments: [...s.comments, comment], activeCommentLocation: null }));
    },
    removeComment(id) {
        set((s) => ({ comments: s.comments.filter((c) => c.id !== id) }));
    },
    clearComments() {
        set({ comments: [], activeCommentLocation: null, summary: '' });
    },
    setActiveCommentLocation(location) {
        set({ activeCommentLocation: location });
    },
    setSummary(summary) {
        set({ summary });
    },
    discardReview() {
        set({ comments: [], activeCommentLocation: null, summary: '' });
    },
}));
