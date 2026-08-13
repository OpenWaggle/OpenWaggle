import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload';
interface PendingCommentProps {
    readonly comment: ReviewCommentWithSnippet;
    readonly onRemove: () => void;
}
/**
 * A saved-but-unsent Review comment, shown inline where it is anchored. Marked
 * "Pending" so it is obvious the agent has not received it yet -- the same signal
 * GitLab gives while a review is in progress.
 */
export declare function PendingComment({ comment, onRemove }: PendingCommentProps): import("node_modules/@types/react").JSX.Element;
export {};
