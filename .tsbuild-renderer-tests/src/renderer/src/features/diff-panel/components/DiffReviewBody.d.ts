import type { CodeViewHandle } from '@pierre/diffs/react';
import type { GitFileDiff } from '@shared/types/git';
import type { Ref } from 'react';
import type { ReviewAnnotationMetadata } from '@/features/diff-panel/lib/code-view-items';
interface DiffReviewBodyProps {
    readonly viewerRef: Ref<CodeViewHandle<ReviewAnnotationMetadata>>;
    readonly files: readonly GitFileDiff[];
    readonly isLoading: boolean;
    readonly onSendMessage: (content: string) => void;
    readonly onFileClick: (path: string) => void;
}
/**
 * The diff surface, its Changed-file navigator, and the Review bar.
 *
 * Owns the review concern rather than receiving it: the state is store-backed, so
 * subscribing here keeps DiffPanel free of review wiring and avoids drilling a
 * callback per action through it.
 */
export declare function DiffReviewBody({ viewerRef, files, isLoading, onSendMessage, onFileClick, }: DiffReviewBodyProps): import("node_modules/@types/react").JSX.Element;
export {};
