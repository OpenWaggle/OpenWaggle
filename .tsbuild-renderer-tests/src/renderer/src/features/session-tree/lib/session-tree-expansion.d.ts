import type { SessionNodeId } from '@shared/types/brand';
import type { SessionNode, SessionTreeUiState } from '@shared/types/session';
export declare function getDefaultExpandedSessionTreeNodeIds(nodes: readonly SessionNode[]): readonly SessionNodeId[];
export declare function resolveExpandedSessionTreeNodeIds(input: {
    readonly nodes: readonly SessionNode[];
    readonly uiState: SessionTreeUiState | null;
    readonly overrideNodeIds: readonly SessionNodeId[] | null;
}): readonly SessionNodeId[];
export declare function resolveSessionTreeRowExpandedNodeIds(input: {
    readonly filteredNodes: readonly SessionNode[];
    readonly expandedNodeIds: readonly SessionNodeId[];
    readonly searchActive: boolean;
}): readonly SessionNodeId[];
