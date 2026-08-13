import type { CodeViewItem, DiffLineAnnotation } from '@pierre/diffs';
import type { GitFileDiff } from '@shared/types/git';
/** Metadata carried on each rendered annotation so the renderer can dispatch back to us. */
export interface ReviewAnnotationMetadata {
    /** 'draft' is the open composer; 'pending' is a saved comment awaiting review submit. */
    readonly kind: 'draft' | 'pending';
    readonly filePath: string;
    readonly commentId?: string;
}
export type ReviewAnnotation = DiffLineAnnotation<ReviewAnnotationMetadata>;
export type ReviewCodeViewItem = CodeViewItem<ReviewAnnotationMetadata>;
export declare function codeViewItemId(filePath: string): string;
/**
 * Build the renderer's item list from the diffs we already load. One scroll
 * region containing many files is what CodeView is for, so the whole panel is a
 * single virtualized list rather than a component per file.
 *
 * `version` is content-addressed for the same reason as the cache key: CodeView
 * decides whether to re-render an item from its id plus version, so the version
 * must move when the patch or its annotations move.
 */
export declare function buildCodeViewItems(files: readonly GitFileDiff[], annotationsByPath: ReadonlyMap<string, readonly ReviewAnnotation[]>): ReviewCodeViewItem[];
