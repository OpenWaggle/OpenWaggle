interface InlineCommentProps {
    readonly startLine: number;
    readonly endLine: number;
    /** Once a Review is open, the batch action reads "Add to review" (GitLab). */
    readonly hasPendingReview: boolean;
    readonly onAddSingleComment: (content: string) => void;
    readonly onAddToReview: (content: string) => void;
    readonly onCancel: () => void;
}
export declare function InlineComment({ startLine, endLine, hasPendingReview, onAddSingleComment, onAddToReview, onCancel, }: InlineCommentProps): import("node_modules/@types/react").JSX.Element;
export {};
