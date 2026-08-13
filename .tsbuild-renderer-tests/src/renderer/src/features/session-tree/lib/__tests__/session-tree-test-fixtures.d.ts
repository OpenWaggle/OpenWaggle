import { SessionId } from '@shared/types/brand';
import type { SessionNode, SessionTreeUiState } from '@shared/types/session';
import { type SessionTreeRow } from '../session-tree-visibility';
export declare const SESSION_ID: SessionId;
export declare const FIRST_ROW_INDEX = 0;
export declare const SECOND_ROW_INDEX = 1;
export declare const THIRD_ROW_INDEX = 2;
export declare const FIFTH_ROW_INDEX = 4;
export declare const ROOT_DOT_X = 14;
export declare const FIRST_BRANCH_DOT_X = 38;
export declare const SECOND_BRANCH_DOT_X = 62;
export declare const ROW_TOP_OVERLAP_Y = -1;
export declare const ROW_CENTER_Y = 20;
export declare const ROW_BOTTOM_OVERLAP_Y = 41;
export declare function node(input: {
    readonly id: string;
    readonly parentId?: string | null;
    readonly depth: number;
    readonly order: number;
}): SessionNode;
export declare function treeUiState(input: {
    readonly expandedNodeIds: readonly string[];
    readonly expandedNodeIdsTouched: boolean;
}): SessionTreeUiState;
export declare function rowIds(rows: readonly SessionTreeRow[]): string[];
export declare function rowDepths(rows: readonly SessionTreeRow[]): number[];
export declare function connectorLineXs(lines: readonly {
    readonly xPx: number;
    readonly yStartPx: number;
    readonly yEndPx: number;
}[]): number[];
export declare function rowAt(rows: readonly SessionTreeRow[], index: number): SessionTreeRow;
export declare function nodeAt(nodes: readonly SessionNode[], index: number): SessionNode;
export declare function visibleRows(input: {
    readonly nodes: readonly SessionNode[];
    readonly filteredNodes?: readonly SessionNode[];
    readonly expandedNodeIds?: readonly string[];
    readonly activePathIds?: readonly string[];
}): readonly SessionTreeRow[];
export declare const TREE: SessionNode[];
export declare const LINEAR_TREE: SessionNode[];
export declare const BRANCH_TREE: SessionNode[];
export declare const BRANCH_LEAF_SIBLING_TREE: SessionNode[];
