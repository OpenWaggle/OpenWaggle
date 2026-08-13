import type { GitFileDiff } from '@shared/types/git';
export type FileChangeStatus = 'added' | 'modified' | 'deleted';
export interface FileChangeStats {
    readonly status: FileChangeStatus;
    readonly additions: number;
    readonly deletions: number;
}
/** A node in the Changed-file navigator. Ids are repo-relative paths. */
export interface NavigatorNode {
    readonly path: string;
    readonly name: string;
    readonly isFile: boolean;
    readonly stats?: FileChangeStats;
}
export interface NavigatorTree {
    readonly nodes: ReadonlyMap<string, NavigatorNode>;
    readonly childrenByPath: ReadonlyMap<string, readonly string[]>;
    readonly rootId: string;
}
export declare const NAVIGATOR_ROOT_ID = "";
/**
 * Git reports add/delete through the patch's mode header rather than a status
 * field, so derive the status from the patch we already have.
 */
export declare function fileChangeStats(file: GitFileDiff): FileChangeStats;
/**
 * Build the navigator's directory tree from flat file paths.
 *
 * Kept pure and separate from the component so the grouping is testable without
 * a tree library, and so swapping the rendering layer cannot change the shape.
 */
export declare function buildNavigatorTree(files: readonly GitFileDiff[]): NavigatorTree;
