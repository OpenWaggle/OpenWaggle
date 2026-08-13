import { type CodeViewHandle } from '@pierre/diffs/react';
import type { GitFileDiff } from '@shared/types/git';
import { type Ref } from 'react';
import { type ReviewAnnotationMetadata } from '@/features/diff-panel/lib/code-view-items';
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload';
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store';
export type DiffViewLayout = 'unified' | 'split';
export interface DiffViewOptions {
    readonly syntaxTheme: string;
    readonly diffView: DiffViewLayout;
    readonly wrapLines: boolean;
}
/** Review state and callbacks, grouped so the call site stays a focused boundary. */
export interface DiffCodeViewReview {
    readonly comments: readonly ReviewCommentWithSnippet[];
    readonly activeCommentLocation: ReviewCommentLocation | null;
    readonly onSetActiveComment: (location: ReviewCommentLocation | null) => void;
    readonly onAddSingleComment: (location: ReviewCommentLocation, content: string) => void;
    readonly onAddToReview: (location: ReviewCommentLocation, content: string) => void;
    readonly onRemoveComment: (id: string) => void;
}
interface DiffCodeViewProps {
    readonly viewerRef?: Ref<CodeViewHandle<ReviewAnnotationMetadata>>;
    readonly files: readonly GitFileDiff[];
    readonly isLoading: boolean;
    readonly viewOptions: DiffViewOptions;
    readonly review: DiffCodeViewReview;
}
export declare function DiffCodeView({ viewerRef, files, isLoading, viewOptions, review, }: DiffCodeViewProps): import("node_modules/@types/react").JSX.Element;
export {};
