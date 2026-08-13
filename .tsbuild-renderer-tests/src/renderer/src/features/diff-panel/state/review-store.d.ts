import type { ReviewComment } from '@shared/types/review';
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload';
export type ReviewCommentLineType = 'add' | 'remove' | 'context';
/** Where a comment is anchored. A range when the user selected several lines. */
export interface ReviewCommentLocation {
    readonly filePath: string;
    readonly line: number;
    readonly endLine?: number;
    readonly lineType: ReviewCommentLineType;
}
interface ReviewState {
    /** Pending comments: saved locally, not yet sent to the agent. */
    comments: ReviewCommentWithSnippet[];
    /** The open comment composer, if any. */
    activeCommentLocation: ReviewCommentLocation | null;
    /** Optional overall instruction, attached at submit time. */
    summary: string;
    addComment: (comment: ReviewCommentWithSnippet) => void;
    removeComment: (id: string) => void;
    clearComments: () => void;
    setActiveCommentLocation: (location: ReviewCommentLocation | null) => void;
    setSummary: (summary: string) => void;
    /** Abandon the whole pending review without sending it. */
    discardReview: () => void;
}
export declare const useReviewStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<ReviewState>>;
/** Legacy alias kept so callers that only need the base shape still compile. */
export type { ReviewComment };
