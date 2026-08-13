import type { ReviewComment } from '@shared/types/review';
/** Lines of a unified patch, excluding headers, with their resolved line numbers. */
interface PatchLine {
    readonly raw: string;
    readonly oldLine: number | null;
    readonly newLine: number | null;
}
/**
 * Walk a unified patch tracking both line numberings. Header lines (`diff --git`,
 * `index`, `---`, `+++`) carry no line numbers and are dropped, so a snippet is
 * always renderable diff body.
 */
export declare function readPatchLines(patch: string): PatchLine[];
/**
 * The diff text a comment is anchored to, plus surrounding context so the agent
 * can see what changed without re-reading the file.
 */
export declare function extractDiffSnippet(patch: string, startLine: number, endLine: number, contextLines?: number): string;
/**
 * Fence long enough to survive the contents. A diff of a Markdown file routinely
 * contains ``` itself, which would otherwise terminate the block early and
 * corrupt everything after it in the message.
 */
export declare function formatFence(language: string, contents: string): string;
export declare function formatLineRange(startLine: number, endLine: number): string;
export interface ReviewCommentWithSnippet extends ReviewComment {
    /** Unified-diff snippet for the commented range; empty when unavailable. */
    readonly diff: string;
}
/** One structured, machine-parseable comment block. */
export declare function formatReviewCommentBlock(comment: ReviewCommentWithSnippet): string;
/**
 * The whole Review as one message: optional summary framing, then every comment.
 * Mirrors a GitLab review submission -- one turn, not one message per comment.
 */
export declare function formatReviewSubmission(summary: string, comments: readonly ReviewCommentWithSnippet[]): string;
/** A single comment sent on its own, without opening a Review. */
export declare function formatSingleReviewComment(comment: ReviewCommentWithSnippet): string;
export {};
