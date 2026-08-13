import type { JsonObject } from '@shared/types/json';
export declare const JSON_STRINGIFY_SPACES = 2;
export declare const LONG_ARGUMENT_PREVIEW_CHARS = 120;
export declare const LONG_ARGUMENT_MAX_HEIGHT_PX = 200;
export declare const RESULT_MAX_HEIGHT_PX = 300;
export declare const INLINE_DIFF_LINE_LIMIT = 32;
export declare const OUTPUT_PREVIEW_LINES = 6;
export declare const LINE_SPLIT_SEPARATOR = "\n";
export declare const HIGHLIGHT_MAX_CHARS = 80000;
export declare const HIGHLIGHT_MAX_LINES = 1200;
export declare const MIN_MARKDOWN_FENCE_LENGTH = 3;
export declare const FILE_CONTENT_ARG_KEYS: Set<string>;
export interface ToolCallResultPayload {
    readonly content: unknown;
    readonly state: string;
    readonly sourceMessageId?: string;
    readonly error?: string;
}
export interface UnifiedDiffLine {
    readonly type: 'add' | 'remove' | 'context' | 'meta';
    readonly content: string;
    /**
     * 0-based position in the parsed diff. A diff line has no other identity
     * (content repeats — blank context lines, identical edits), so position IS its
     * identity; carrying it in the data gives React a stable key without keying on
     * the render index (react-doctor/no-array-index-as-key).
     */
    readonly lineIndex: number;
}
export interface UnifiedDiffData {
    readonly text: string;
    readonly lines: readonly UnifiedDiffLine[];
    readonly additions: number;
    readonly deletions: number;
}
export declare function getToolResultText(content: unknown): string;
export declare function getStringArg(args: JsonObject, key: string): string | null;
export declare function inferLanguageFromPath(path: string | null): "go" | "bash" | "css" | "html" | "javascript" | "json" | "markdown" | "python" | "rust" | "sql" | "typescript" | "yaml" | undefined;
export declare function shouldHighlightCode(text: string): boolean;
export declare function buildFencedCodeMarkdown(code: string, language: string | undefined): string;
export declare function getResultError(result: ToolCallResultPayload | undefined): string | null;
export declare function getUnifiedDiffLineClassName(type: UnifiedDiffLine['type']): "text-text-secondary" | "text-text-muted" | "bg-error/10 text-error" | "bg-success/10 text-success";
export declare function getEditUnifiedDiff(content: unknown, name: string): UnifiedDiffData | null;
export declare function buildTailPreview(text: string): string;
