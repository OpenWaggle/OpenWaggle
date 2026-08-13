import type { SessionNode, SessionTree, SessionTreeFilterMode } from '@shared/types/session';
import type { ExpandedNodeIdsOverride } from '../model';
interface BuildSessionTreePanelRowsInput {
    readonly tree: SessionTree | null;
    readonly transcriptPath: readonly {
        readonly node: SessionNode;
    }[];
    readonly filterMode: SessionTreeFilterMode;
    readonly searchQuery: string;
    readonly focusIndex: number;
    readonly expandedNodeIdsOverride: ExpandedNodeIdsOverride | null;
}
export declare function buildSessionTreePanelRows(input: BuildSessionTreePanelRowsInput): {
    activePathIds: Set<string>;
    clampedFocusIndex: number;
    expandedNodeIds: readonly import("../../../../../shared/types/brand").SessionNodeId[];
    rowExpandedNodeIds: readonly import("../../../../../shared/types/brand").SessionNodeId[];
    searchActive: boolean;
    visibleNodes: SessionNode[];
    visibleRows: readonly import("../model").SessionTreeRow[];
};
export {};
