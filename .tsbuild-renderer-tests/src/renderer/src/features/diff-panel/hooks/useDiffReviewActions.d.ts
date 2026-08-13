import type { GitFileDiff } from '@shared/types/git';
import { type ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload';
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store';
/**
 * Review actions for the diff panel.
 *
 * Two paths, both self-contained in the panel: send one comment immediately, or
 * accumulate a Review and submit it with an optional summary as a single message.
 * Neither touches the composer.
 */
export declare function useDiffReviewActions(onSendMessage: (content: string) => void, files: readonly GitFileDiff[]): {
    comments: ReviewCommentWithSnippet[];
    summary: string;
    onAddSingleComment: (location: ReviewCommentLocation, content: string) => void;
    onAddToReview: (location: ReviewCommentLocation, content: string) => void;
    onRemoveComment: (id: string) => void;
    onSetSummary: (summary: string) => void;
    onSubmitReview: () => void;
    onDiscardReview: () => void;
};
